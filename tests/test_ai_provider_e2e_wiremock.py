"""WireMock E2E for OpenAI provider via AI_PROVIDER_POST (M21.2)."""

from __future__ import annotations

import os
import uuid
from typing import Any

import httpx
import pytest
from sqlalchemy.orm import Session

from app.logs.models import DeliveryLog
from app.runners.stream_loader import load_stream_context
from app.runners.stream_runner import StreamRunner
from tests.e2e_wiremock_helpers import reset_wiremock_journal, wiremock_reachable
from tests.test_ai_provider_post_destination import _seed_ai_stream
from tests.test_stream_runner_e2e import _AllowAllLimiter, _FakePoller, _FailIfCalledSyslogSender

pytestmark = pytest.mark.e2e_smoke

WIREMOCK_BASE = os.getenv("WIREMOCK_BASE_URL", "http://127.0.0.1:28080").rstrip("/")


def _wiremock_admin_ok(base: str) -> bool:
    if not wiremock_reachable(base):
        return False
    try:
        resp = httpx.get(f"{base}/__admin/mappings", timeout=2.0)
        return resp.status_code == 200
    except httpx.HTTPError:
        return False


skip_no_wiremock = pytest.mark.skipif(
    not _wiremock_admin_ok(WIREMOCK_BASE),
    reason=f"WireMock admin not reachable at {WIREMOCK_BASE}",
)


def _register_openai_stub(
    base: str,
    *,
    mapping_id: str,
    status: int,
    body: dict[str, Any] | None = None,
    fixed_delay_ms: int | None = None,
    scenario: dict[str, Any] | None = None,
) -> None:
    response: dict[str, Any] = {"status": status}
    if body is not None:
        response["jsonBody"] = body
        response["headers"] = {"Content-Type": "application/json"}
    if fixed_delay_ms is not None:
        response["fixedDelayMilliseconds"] = fixed_delay_ms
    doc: dict[str, Any] = {
        "id": mapping_id,
        "name": mapping_id,
        "request": {"method": "POST", "urlPath": "/ai-openai/v1/chat/completions"},
        "response": response,
    }
    if scenario is not None:
        doc["scenarioName"] = scenario["name"]
        doc["requiredScenarioState"] = scenario.get("required", "Started")
        doc["newScenarioState"] = scenario.get("new", "Started")
    try:
        httpx.delete(f"{base}/__admin/mappings/{mapping_id}", timeout=5.0)
    except httpx.HTTPError:
        pass
    resp = httpx.post(f"{base}/__admin/mappings", json=doc, timeout=15.0)
    assert resp.status_code in (200, 201), resp.text


def _delivery_stages(db_session: Session, stream_id: int) -> list[str]:
    rows = (
        db_session.query(DeliveryLog)
        .filter(DeliveryLog.stream_id == stream_id)
        .order_by(DeliveryLog.id.asc())
        .all()
    )
    return [str(row.stage) for row in rows]


def _seed_openai_wiremock_stream(db_session: Session, *, retry_count: int = 0, timeout_seconds: int = 5) -> dict[str, Any]:
    return _seed_ai_stream(
        db_session,
        provider_type="OPENAI",
        retry_count=retry_count,
        endpoint_url=f"{WIREMOCK_BASE}/ai-openai",
        timeout_seconds=timeout_seconds,
    )


@skip_no_wiremock
def test_wiremock_openai_success(db_session: Session) -> None:
    mapping_id = str(uuid.uuid4())
    _register_openai_stub(
        WIREMOCK_BASE,
        mapping_id=mapping_id,
        status=200,
        body={
            "id": "cmpl-wiremock-1",
            "model": "gpt-4o",
            "choices": [{"message": {"content": "WireMock OK"}}],
        },
    )
    reset_wiremock_journal(WIREMOCK_BASE)
    stack = _seed_openai_wiremock_stream(db_session)
    poller = _FakePoller(
        response={
            "items": [
                {
                    "provider_request": {
                        "model": "gpt-4o",
                        "messages": [{"role": "user", "content": "hello"}],
                    }
                }
            ]
        }
    )
    runner = StreamRunner(
        poller=poller,
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        syslog_sender=_FailIfCalledSyslogSender(),
    )
    ctx = load_stream_context(db_session, stack["stream_id"])
    summary = runner.run(ctx, db=db_session)
    assert summary["outcome"] == "completed"
    assert "route_send_success" in _delivery_stages(db_session, stack["stream_id"])


@skip_no_wiremock
def test_wiremock_openai_429_then_success(db_session: Session) -> None:
    scenario = str(uuid.uuid4())
    _register_openai_stub(
        WIREMOCK_BASE,
        mapping_id=str(uuid.uuid4()),
        status=429,
        body={"error": {"message": "rate limited"}},
        scenario={"name": scenario, "required": "Started", "new": "Retried"},
    )
    _register_openai_stub(
        WIREMOCK_BASE,
        mapping_id=str(uuid.uuid4()),
        status=200,
        body={
            "id": "cmpl-wiremock-retry",
            "model": "gpt-4o",
            "choices": [{"message": {"content": "recovered"}}],
        },
        scenario={"name": scenario, "required": "Retried", "new": "Done"},
    )
    stack = _seed_openai_wiremock_stream(db_session, retry_count=1)
    poller = _FakePoller(
        response={
            "items": [
                {
                    "provider_request": {
                        "model": "gpt-4o",
                        "messages": [{"role": "user", "content": "retry please"}],
                    }
                }
            ]
        }
    )
    runner = StreamRunner(
        poller=poller,
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        syslog_sender=_FailIfCalledSyslogSender(),
    )
    ctx = load_stream_context(db_session, stack["stream_id"])
    summary = runner.run(ctx, db=db_session)
    assert summary["outcome"] == "completed"
    assert "route_send_success" in _delivery_stages(db_session, stack["stream_id"])


@skip_no_wiremock
def test_wiremock_openai_500_fails(db_session: Session) -> None:
    mapping_id = str(uuid.uuid4())
    _register_openai_stub(
        WIREMOCK_BASE,
        mapping_id=mapping_id,
        status=500,
        body={"error": {"message": "server error"}},
    )
    stack = _seed_openai_wiremock_stream(db_session, retry_count=0)
    poller = _FakePoller(
        response={
            "items": [
                {
                    "provider_request": {
                        "model": "gpt-4o",
                        "messages": [{"role": "user", "content": "fail"}],
                    }
                }
            ]
        }
    )
    runner = StreamRunner(
        poller=poller,
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        syslog_sender=_FailIfCalledSyslogSender(),
    )
    ctx = load_stream_context(db_session, stack["stream_id"])
    summary = runner.run(ctx, db=db_session)
    assert "route_send_failed" in _delivery_stages(db_session, stack["stream_id"])


@skip_no_wiremock
def test_wiremock_openai_timeout_fails(db_session: Session) -> None:
    mapping_id = str(uuid.uuid4())
    _register_openai_stub(
        WIREMOCK_BASE,
        mapping_id=mapping_id,
        status=200,
        body={"id": "slow", "choices": [{"message": {"content": "slow"}}]},
        fixed_delay_ms=8000,
    )
    stack = _seed_openai_wiremock_stream(db_session, retry_count=0, timeout_seconds=2)
    poller = _FakePoller(
        response={
            "items": [
                {
                    "provider_request": {
                        "model": "gpt-4o",
                        "messages": [{"role": "user", "content": "slow"}],
                    }
                }
            ]
        }
    )
    runner = StreamRunner(
        poller=poller,
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        syslog_sender=_FailIfCalledSyslogSender(),
    )
    ctx = load_stream_context(db_session, stack["stream_id"])
    summary = runner.run(ctx, db=db_session)
    assert "route_send_failed" in _delivery_stages(db_session, stack["stream_id"])
