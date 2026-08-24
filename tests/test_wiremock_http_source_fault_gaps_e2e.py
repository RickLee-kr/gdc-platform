"""HTTP source fault automation gaps (403 / timeout / malformed) — WireMock pytest.

Closes P0-4 gaps documented in docs/testing/qa-automation-architecture-audit.md:
checkpoint hold + destination collector no-delivery + structured runtime failure.

Does not duplicate the existing 401 coverage in test_wiremock_template_e2e.py, nor
Toxiproxy TCP latency hold/recover (test_toxiproxy_network_fault_e2e.py).
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.database import get_db
from app.logs.models import DeliveryLog
from app.main import app
from app.templates.registry import clear_template_cache
from tests.e2e_wiremock_helpers import (
    DEFAULT_WIREMOCK,
    create_webhook_destination,
    enable_stream_for_run,
    ensure_template_wiremock_mappings,
    reset_wiremock_journal,
    reset_wiremock_scenarios,
    wiremock_reachable,
    wiremock_received_json_bodies,
    wiremock_request_count,
)

pytestmark = [pytest.mark.wiremock_integration, pytest.mark.e2e_regression, pytest.mark.e2e_checkpoint]
skip_no_wiremock = pytest.mark.skipif(
    not wiremock_reachable(DEFAULT_WIREMOCK),
    reason=f"WireMock not reachable at {DEFAULT_WIREMOCK} (start: docker compose --profile test up -d wiremock)",
)


@pytest.fixture
def client(db_session: Session) -> TestClient:
    clear_template_cache()

    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        clear_template_cache()


def _seed_fault_stream(
    client: TestClient,
    *,
    connector_name: str,
    dest_path: str,
    endpoint: str,
    timeout_seconds: float | None = None,
    retry_count: int | None = None,
    retry_backoff_seconds: float | None = None,
) -> dict[str, Any]:
    base = DEFAULT_WIREMOCK.rstrip("/")
    ensure_template_wiremock_mappings(base)
    reset_wiremock_scenarios(base)
    reset_wiremock_journal(base)

    dest_id = create_webhook_destination(client, base, path=dest_path, retry_count=0)
    ins = client.post(
        "/api/v1/templates/generic_rest_polling/instantiate",
        json={
            "connector_name": connector_name,
            "host": base,
            "credentials": {"bearer_token": "template-e2e-generic-bearer"},
            "destination_id": dest_id,
            "create_route": True,
        },
    )
    assert ins.status_code == 201, ins.text
    stream_id = int(ins.json()["stream_id"])
    ck_id = int(ins.json()["checkpoint_id"])

    st = client.get(f"/api/v1/streams/{stream_id}").json()
    cfg = dict(st.get("config_json") or {})
    cfg["endpoint"] = endpoint
    if timeout_seconds is not None:
        cfg["timeout_seconds"] = timeout_seconds
    if retry_count is not None:
        cfg["retry_count"] = retry_count
    if retry_backoff_seconds is not None:
        cfg["retry_backoff_seconds"] = retry_backoff_seconds
    up = client.put(f"/api/v1/streams/{stream_id}", json={"config_json": cfg})
    assert up.status_code == 200, up.text

    return {
        "base": base,
        "stream_id": stream_id,
        "checkpoint_id": ck_id,
        "dest_path": dest_path,
        "endpoint": endpoint,
    }


def _checkpoint_value(db: Session, ck_id: int) -> dict[str, Any]:
    db.expire_all()
    row = db.get(Checkpoint, ck_id)
    assert row is not None
    return dict(row.checkpoint_value_json or {})


def _assert_source_failure_hold(
    db: Session,
    *,
    stream_id: int,
    ck_id: int,
    cp_before: dict[str, Any],
    base: str,
    dest_path: str,
) -> set[str]:
    db.expire_all()
    rows = db.query(DeliveryLog).filter(DeliveryLog.stream_id == stream_id).all()
    stages = {str(row.stage) for row in rows}
    allowed = {
        "run_started",
        "run_failed",
        "source_fetch_started",
        "source_fetch_failed",
        "checkpoint_held",
    }
    assert stages <= allowed, stages
    assert "route_send_success" not in stages
    assert "checkpoint_update" not in stages
    assert "run_failed" in stages
    assert "checkpoint_held" in stages
    assert _checkpoint_value(db, ck_id) == cp_before
    assert wiremock_received_json_bodies(base, path_contains=dest_path) == []
    assert wiremock_request_count(base, path_contains=dest_path) == 0
    return stages


@skip_no_wiremock
@pytest.mark.e2e_auth
def test_http_source_403_structured_failure_checkpoint_hold_no_delivery(
    client: TestClient, db_session: Session
) -> None:
    """HTTP 403 → SOURCE_HTTP_ERROR, no retries, no destination delivery, checkpoint hold."""

    dest_path = "/receiver/http-gap-403"
    endpoint = "/api/v1/events-403"
    stack = _seed_fault_stream(
        client,
        connector_name="WireMock HTTP gap 403",
        dest_path=dest_path,
        endpoint=endpoint,
        retry_count=2,
        retry_backoff_seconds=0,
    )
    stream_id = stack["stream_id"]
    ck_id = stack["checkpoint_id"]
    base = stack["base"]
    cp_before = _checkpoint_value(db_session, ck_id)

    enable_stream_for_run(client, stream_id)
    run = client.post(f"/api/v1/runtime/streams/{stream_id}/run-once")
    assert run.status_code == 502, run.text
    err = run.json().get("detail") or {}
    assert err.get("error_code") == "SOURCE_HTTP_ERROR"
    assert int(err.get("response_status") or 0) == 403
    assert "forbidden" in str(err.get("response_body") or "").lower() or int(err.get("response_status") or 0) == 403

    _assert_source_failure_hold(
        db_session,
        stream_id=stream_id,
        ck_id=ck_id,
        cp_before=cp_before,
        base=base,
        dest_path=dest_path,
    )
    # 4xx with response_status fails fast — no poller retries.
    assert wiremock_request_count(base, path_contains=endpoint) == 1


@skip_no_wiremock
@pytest.mark.e2e_retry
def test_http_source_timeout_retries_then_failure_checkpoint_hold_no_delivery(
    client: TestClient, db_session: Session
) -> None:
    """WireMock delay > timeout_seconds → transport retries → final source failure + hold."""

    import uuid

    import httpx

    dest_path = "/receiver/http-gap-timeout"
    # Unique path avoids cross-talk from leftover RUNNING streams on shared WireMock.
    endpoint = f"/api/v1/events-timeout-{uuid.uuid4().hex[:12]}"
    retry_count = 1
    base = DEFAULT_WIREMOCK.rstrip("/")
    stub = {
        "id": str(uuid.uuid4()),
        "priority": 1,
        "request": {"method": "GET", "urlPath": endpoint},
        "response": {
            "status": 200,
            "fixedDelayMilliseconds": 5000,
            "headers": {"Content-Type": "application/json"},
            "jsonBody": {"data": []},
        },
    }
    httpx.delete(f"{base}/__admin/mappings/{stub['id']}", timeout=5.0)
    reg = httpx.post(f"{base}/__admin/mappings", json=stub, timeout=15.0)
    assert reg.status_code in (200, 201), reg.text

    stack = _seed_fault_stream(
        client,
        connector_name="WireMock HTTP gap timeout",
        dest_path=dest_path,
        endpoint=endpoint,
        timeout_seconds=1,
        retry_count=retry_count,
        retry_backoff_seconds=0,
    )
    stream_id = stack["stream_id"]
    ck_id = stack["checkpoint_id"]
    base = stack["base"]
    cp_before = _checkpoint_value(db_session, ck_id)

    enable_stream_for_run(client, stream_id)
    run = client.post(f"/api/v1/runtime/streams/{stream_id}/run-once")
    assert run.status_code == 502, run.text
    err = run.json().get("detail") or {}
    assert err.get("error_code") == "SOURCE_FETCH_FAILED"
    msg = str(err.get("message") or "").lower()
    assert "failed after retries" in msg
    assert "timeout" in msg or "timed out" in msg or "readtimeout" in msg or "connecttimeout" in msg

    _assert_source_failure_hold(
        db_session,
        stream_id=stream_id,
        ck_id=ck_id,
        cp_before=cp_before,
        base=base,
        dest_path=dest_path,
    )
    # Count only this stream's decrypted bearer traffic (shared WireMock may see
    # foreign clients; ciphertext on the wire is still a hard failure below).
    journal = httpx.get(f"{base}/__admin/requests", timeout=10.0)
    journal.raise_for_status()
    plaintext_hits = 0
    for entry in journal.json().get("requests") or []:
        req = entry.get("request") or {}
        url = str(req.get("absoluteUrl") or req.get("url") or "")
        if endpoint not in url:
            continue
        headers = req.get("headers") or {}
        auth = str(headers.get("Authorization") or headers.get("authorization") or "")
        assert "__gdc_enc__" not in auth, auth
        assert "AESGCM" not in auth, auth
        if auth == "Bearer template-e2e-generic-bearer":
            plaintext_hits += 1
    assert plaintext_hits == retry_count + 1


@skip_no_wiremock
def test_http_source_malformed_json_retries_then_failure_checkpoint_hold_no_delivery(
    client: TestClient, db_session: Session
) -> None:
    """HTTP 200 with `{not-json` → parse failure retried → final source failure + hold."""

    dest_path = "/receiver/http-gap-malformed"
    endpoint = "/api/v1/events-malformed"
    retry_count = 1
    stack = _seed_fault_stream(
        client,
        connector_name="WireMock HTTP gap malformed",
        dest_path=dest_path,
        endpoint=endpoint,
        retry_count=retry_count,
        retry_backoff_seconds=0,
    )
    stream_id = stack["stream_id"]
    ck_id = stack["checkpoint_id"]
    base = stack["base"]
    cp_before = _checkpoint_value(db_session, ck_id)

    enable_stream_for_run(client, stream_id)
    run = client.post(f"/api/v1/runtime/streams/{stream_id}/run-once")
    assert run.status_code == 502, run.text
    err = run.json().get("detail") or {}
    assert err.get("error_code") == "SOURCE_FETCH_FAILED"
    msg = str(err.get("message") or "")
    assert "failed after retries" in msg.lower()
    assert "not valid json" in msg.lower()

    _assert_source_failure_hold(
        db_session,
        stream_id=stream_id,
        ck_id=ck_id,
        cp_before=cp_before,
        base=base,
        dest_path=dest_path,
    )
    # Parse failures lack response_status detail → poller retries (product contract).
    assert wiremock_request_count(base, path_contains=endpoint) == retry_count + 1
