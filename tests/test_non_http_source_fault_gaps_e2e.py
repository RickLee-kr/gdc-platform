"""Non-HTTP source fault automation gaps — MinIO / PG fixture / atmoz SFTP.

Closes P0-4 gaps in docs/history/testing/qa-automation-architecture-audit.md:
S3 auth/AccessDenied, DATABASE_QUERY statement timeout, SFTP auth + invalid path.

Asserts: live external failure (not mocked exceptions) → SOURCE_FETCH_FAILED →
no destination delivery → checkpoint hold → recoverable recovery when applicable.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db
from app.logs.models import DeliveryLog
from app.main import app
from app.templates.registry import clear_template_cache
from tests.e2e_runtime_helpers import (
    MINIO_ACCESS_KEY,
    MINIO_SECRET_KEY,
    SFTP_PASSWORD,
    SFTP_USER,
    WIREMOCK_BASE,
    checkpoint_snapshot,
    create_db_query_connector_and_stream,
    create_remote_file_connector_and_stream,
    create_s3_connector_and_stream,
    ensure_checkpoint,
    minio_reachable,
    pg_fixture_reachable,
    prepare_wiremock_run,
    reset_pg_fixture_seed,
    run_once,
    save_mapping_enrichment,
    seed_isolated_s3_objects,
    sftp_reachable,
    upload_sftp_file,
    wiremock_ok,
    wiremock_received_json_bodies,
)
from tests.e2e_wiremock_helpers import (
    enable_stream_for_run,
    reset_wiremock_journal,
    wiremock_request_count,
)

pytestmark = [
    pytest.mark.e2e_runtime,
    pytest.mark.e2e_external,
    pytest.mark.e2e_regression,
    pytest.mark.e2e_checkpoint,
]

skip_no_wiremock = pytest.mark.skipif(not wiremock_ok(), reason=f"WireMock not reachable at {WIREMOCK_BASE}")
skip_no_minio = pytest.mark.skipif(not minio_reachable(), reason="MinIO fixture port not open")
skip_no_pg = pytest.mark.skipif(not pg_fixture_reachable(), reason="postgres-query-test port not open")
skip_no_sftp = pytest.mark.skipif(not sftp_reachable(), reason="sftp-test port not open")

_DB_OK_QUERY = {
    "query": (
        "SELECT id, event_id, message, severity, event_ts, ordering_seq "
        "FROM source_e2e_rows ORDER BY event_ts, ordering_seq, id"
    ),
    "max_rows_per_run": 50,
    "checkpoint_mode": "COMPOSITE_ORDER",
    "checkpoint_column": "event_ts",
    "checkpoint_order_column": "ordering_seq",
    "query_timeout_seconds": 30,
}

_DB_TIMEOUT_QUERY = {
    "query": (
        "SELECT 1 AS id, 'timeout-row' AS event_id, 'sleep row' AS message, "
        "'info' AS severity, NOW() AS event_ts, 1 AS ordering_seq, pg_sleep(10) AS slept"
    ),
    "max_rows_per_run": 1,
    "checkpoint_mode": "COMPOSITE_ORDER",
    "checkpoint_column": "event_ts",
    "checkpoint_order_column": "ordering_seq",
    "query_timeout_seconds": 1,
}


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


def _assert_source_failure_hold(
    db: Session,
    *,
    stream_id: int,
    cp_before: dict[str, Any],
    wm_path: str,
) -> None:
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
    failed = [row for row in rows if str(row.stage) == "run_failed"]
    assert failed
    assert str(failed[-1].error_code or "") == "SOURCE_FETCH_FAILED"
    assert checkpoint_snapshot(db, stream_id) == cp_before
    assert wiremock_received_json_bodies(WIREMOCK_BASE, path_contains=wm_path) == []
    assert wiremock_request_count(WIREMOCK_BASE, path_contains=wm_path) == 0


def _run_once_expect_source_fetch_failed(client: TestClient, stream_id: int) -> dict[str, Any]:
    run = client.post(f"/api/v1/runtime/streams/{stream_id}/run-once")
    assert run.status_code == 502, run.text
    err = run.json().get("detail") or {}
    assert err.get("error_code") == "SOURCE_FETCH_FAILED", err
    return err


# --- S3_OBJECT_POLLING: auth / AccessDenied ---


@skip_no_wiremock
@skip_no_minio
@pytest.mark.minio
@pytest.mark.e2e_auth
def test_s3_access_denied_structured_failure_checkpoint_hold_no_delivery_then_recover(
    client: TestClient, db_session: Session
) -> None:
    """Wrong MinIO credentials → live AccessDenied/InvalidAccessKeyId → hold → recover."""

    suffix = uuid.uuid4().hex[:8]
    prefix = seed_isolated_s3_objects(
        suffix,
        {"auth-gap.ndjson": b'{"id":"s3-auth-1","message":"s3 auth recover","severity":"info"}\n'},
    )
    connector_id, _, stream_id = create_s3_connector_and_stream(
        client,
        name_suffix=f"auth-{suffix}",
        prefix=prefix,
        stream_config={"max_objects_per_run": 5},
        source_extras={
            "access_key": "definitely-not-a-valid-minio-key",
            "secret_key": "definitely-not-a-valid-minio-secret-12",
        },
    )
    save_mapping_enrichment(client, stream_id)
    wm_path = f"/source-e2e/gap-s3-auth-{suffix}"
    prepare_wiremock_run(client, stream_id, wm_path)
    ensure_checkpoint(db_session, stream_id)
    cp_before = checkpoint_snapshot(db_session, stream_id)

    err = _run_once_expect_source_fetch_failed(client, stream_id)
    msg = str(err.get("message") or "")
    assert "S3 ListObjectsV2 failed" in msg
    assert any(
        token in msg
        for token in ("AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch", "InvalidAccessKey")
    ), msg
    _assert_source_failure_hold(db_session, stream_id=stream_id, cp_before=cp_before, wm_path=wm_path)

    # Recovery with valid credentials against the same seeded objects.
    fix = client.put(
        f"/api/v1/connectors/{connector_id}",
        json={
            "source_type": "S3_OBJECT_POLLING",
            "access_key": MINIO_ACCESS_KEY,
            "secret_key": MINIO_SECRET_KEY,
        },
    )
    assert fix.status_code == 200, fix.text
    reset_wiremock_journal(WIREMOCK_BASE)
    enable_stream_for_run(client, stream_id)
    ok = run_once(client, stream_id)
    assert ok.get("checkpoint_updated") is True
    assert checkpoint_snapshot(db_session, stream_id) != cp_before
    bodies = wiremock_received_json_bodies(WIREMOCK_BASE, path_contains=wm_path)
    assert any(str(b.get("message") or "") == "s3 auth recover" for b in bodies)


# --- DATABASE_QUERY: statement timeout ---


@skip_no_wiremock
@skip_no_pg
def test_database_query_timeout_aborts_structured_failure_checkpoint_hold_no_delivery_then_recover(
    client: TestClient, db_session: Session
) -> None:
    """pg_sleep longer than query_timeout_seconds → live statement_timeout → hold → recover."""

    reset_pg_fixture_seed()
    suffix = uuid.uuid4().hex[:8]
    _, _, stream_id = create_db_query_connector_and_stream(
        client, name_suffix=f"timeout-{suffix}", stream_config=dict(_DB_TIMEOUT_QUERY)
    )
    save_mapping_enrichment(client, stream_id)
    wm_path = f"/source-e2e/gap-db-timeout-{suffix}"
    prepare_wiremock_run(client, stream_id, wm_path)
    ensure_checkpoint(db_session, stream_id)
    cp_before = checkpoint_snapshot(db_session, stream_id)

    err = _run_once_expect_source_fetch_failed(client, stream_id)
    msg = str(err.get("message") or "").lower()
    assert "query failed" in msg or "statement" in msg or "canceling" in msg or "timeout" in msg
    _assert_source_failure_hold(db_session, stream_id=stream_id, cp_before=cp_before, wm_path=wm_path)

    # Recovery: replace sleep query with normal incremental SELECT.
    st = client.get(f"/api/v1/streams/{stream_id}").json()
    up = client.put(
        f"/api/v1/streams/{stream_id}",
        json={"config_json": {**(st.get("config_json") or {}), **_DB_OK_QUERY}},
    )
    assert up.status_code == 200, up.text
    reset_wiremock_journal(WIREMOCK_BASE)
    enable_stream_for_run(client, stream_id)
    ok = run_once(client, stream_id)
    assert ok.get("checkpoint_updated") is True
    assert int(ok.get("extracted_event_count") or 0) >= 1
    assert checkpoint_snapshot(db_session, stream_id) != cp_before
    assert wiremock_request_count(WIREMOCK_BASE, path_contains=wm_path) >= 1


# --- REMOTE_FILE_POLLING (SFTP): auth failure ---


@skip_no_wiremock
@skip_no_sftp
@pytest.mark.sftp
@pytest.mark.e2e_auth
def test_sftp_auth_failure_structured_failure_checkpoint_hold_no_delivery_then_recover(
    client: TestClient, db_session: Session
) -> None:
    """Wrong SFTP password against live atmoz fixture → hold → recover with correct password."""

    suffix = uuid.uuid4().hex[:8]
    remote_name = f"gap-sftp-auth-{suffix}.ndjson"
    upload_sftp_file(
        remote_name,
        b'{"id":"sftp-auth-1","message":"sftp auth recover","severity":"info"}\n',
    )
    connector_id, _, stream_id = create_remote_file_connector_and_stream(
        client,
        name_suffix=f"auth-{suffix}",
        stream_config={
            "remote_directory": "upload",
            "file_pattern": remote_name,
            "recursive": False,
            "parser_type": "NDJSON",
            "max_files_per_run": 5,
            "max_file_size_mb": 5,
        },
        source_extras={"remote_password": "definitely-wrong-sftp-password"},
    )
    save_mapping_enrichment(client, stream_id)
    wm_path = f"/source-e2e/gap-sftp-auth-{suffix}"
    prepare_wiremock_run(client, stream_id, wm_path)
    ensure_checkpoint(db_session, stream_id)
    cp_before = checkpoint_snapshot(db_session, stream_id)

    err = _run_once_expect_source_fetch_failed(client, stream_id)
    msg = str(err.get("message") or "")
    assert "SSH connect/authentication failed" in msg or "Authentication" in msg
    _assert_source_failure_hold(db_session, stream_id=stream_id, cp_before=cp_before, wm_path=wm_path)

    fix = client.put(
        f"/api/v1/connectors/{connector_id}",
        json={
            "source_type": "REMOTE_FILE_POLLING",
            "remote_username": SFTP_USER,
            "remote_password": SFTP_PASSWORD,
        },
    )
    assert fix.status_code == 200, fix.text
    reset_wiremock_journal(WIREMOCK_BASE)
    enable_stream_for_run(client, stream_id)
    ok = run_once(client, stream_id)
    assert ok.get("checkpoint_updated") is True
    assert checkpoint_snapshot(db_session, stream_id) != cp_before
    bodies = wiremock_received_json_bodies(WIREMOCK_BASE, path_contains=wm_path)
    assert any(str(b.get("message") or "") == "sftp auth recover" for b in bodies)


# --- REMOTE_FILE_POLLING (SFTP): invalid path ---


@skip_no_wiremock
@skip_no_sftp
@pytest.mark.sftp
def test_sftp_invalid_path_structured_failure_checkpoint_hold_no_delivery_then_recover(
    client: TestClient, db_session: Session
) -> None:
    """Non-existent remote_directory on live SFTP → hold → recover with valid directory."""

    suffix = uuid.uuid4().hex[:8]
    remote_name = f"gap-sftp-path-{suffix}.ndjson"
    upload_sftp_file(
        remote_name,
        b'{"id":"sftp-path-1","message":"sftp path recover","severity":"info"}\n',
    )
    bad_dir = f"upload/does-not-exist-{suffix}"
    _, _, stream_id = create_remote_file_connector_and_stream(
        client,
        name_suffix=f"path-{suffix}",
        stream_config={
            "remote_directory": bad_dir,
            "file_pattern": remote_name,
            "recursive": False,
            "parser_type": "NDJSON",
            "max_files_per_run": 5,
            "max_file_size_mb": 5,
        },
    )
    save_mapping_enrichment(client, stream_id)
    wm_path = f"/source-e2e/gap-sftp-path-{suffix}"
    prepare_wiremock_run(client, stream_id, wm_path)
    ensure_checkpoint(db_session, stream_id)
    cp_before = checkpoint_snapshot(db_session, stream_id)

    err = _run_once_expect_source_fetch_failed(client, stream_id)
    msg = str(err.get("message") or "")
    assert "remote directory not accessible" in msg
    assert bad_dir in msg
    _assert_source_failure_hold(db_session, stream_id=stream_id, cp_before=cp_before, wm_path=wm_path)

    st = client.get(f"/api/v1/streams/{stream_id}").json()
    cfg = dict(st.get("config_json") or {})
    cfg["remote_directory"] = "upload"
    up = client.put(f"/api/v1/streams/{stream_id}", json={"config_json": cfg})
    assert up.status_code == 200, up.text
    reset_wiremock_journal(WIREMOCK_BASE)
    enable_stream_for_run(client, stream_id)
    ok = run_once(client, stream_id)
    assert ok.get("checkpoint_updated") is True
    assert checkpoint_snapshot(db_session, stream_id) != cp_before
    bodies = wiremock_received_json_bodies(WIREMOCK_BASE, path_contains=wm_path)
    assert any(str(b.get("message") or "") == "sftp path recover" for b in bodies)
