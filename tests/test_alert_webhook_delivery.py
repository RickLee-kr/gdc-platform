"""Backend tests for platform webhook alert delivery, cooldown, and history."""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.role_guard import ROLE_HEADER
from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.database import get_db
from app.destinations.models import Destination
from app.logs.models import DeliveryLog
from app.main import app
from app.platform_admin.alert_monitor import PlatformAlertMonitor
from app.platform_admin.alert_service import (
    AlertEvent,
    deliver_alert,
    mask_webhook_url,
)
from app.platform_admin.models import (
    PlatformAlertHistory,
    PlatformAlertSettings,
)
from app.platform_admin.repository import get_alert_settings_row
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream

UTC = timezone.utc


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(time, "sleep", lambda _x: None)


def _configure_webhook(db: Session, *, url: str = "https://hooks.example.test/abc?token=xyz", cooldown: int = 600) -> PlatformAlertSettings:
    row = get_alert_settings_row(db)
    row.webhook_url = url
    row.cooldown_seconds = cooldown
    row.monitor_enabled = True
    db.commit()
    return row


def _setup_httpx_capture(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    captured: list[dict[str, Any]] = []

    class _Resp:
        def __init__(self, status_code: int = 204) -> None:
            self.status_code = status_code

    class _Client:
        def __init__(self, *_a: Any, **_kw: Any) -> None:
            pass

        def __enter__(self) -> "_Client":
            return self

        def __exit__(self, *_a: Any) -> None:
            return None

        def post(self, url: str, json: dict[str, Any] | None = None, headers: dict[str, str] | None = None, **_kw: Any) -> _Resp:
            captured.append({"url": url, "json": json, "headers": headers})
            return _Resp(204)

    monkeypatch.setattr(httpx, "Client", _Client)
    return captured


def test_deliver_alert_success_persists_history(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_webhook(db_session)
    captured = _setup_httpx_capture(monkeypatch)

    result = deliver_alert(
        db_session,
        AlertEvent(
            alert_type="stream_paused",
            message="Stream X paused",
            stream_id=42,
            stream_name="Stream X",
            route_id=11,
            destination_id=7,
            trigger_source="unit_test",
        ),
    )
    assert result.delivered is True
    assert result.delivery_status == "sent"
    assert result.http_status == 204
    assert len(captured) == 1
    payload = captured[0]["json"]
    assert payload["alert_type"] == "stream_paused"
    assert payload["severity"] in {"WARNING", "CRITICAL"}
    assert payload["stream_id"] == 42
    assert payload["stream_name"] == "Stream X"
    assert payload["route_id"] == 11
    assert payload["destination_id"] == 7
    assert payload["message"] == "Stream X paused"
    assert payload["timestamp"]

    row = db_session.query(PlatformAlertHistory).filter(PlatformAlertHistory.id == result.history_id).one()
    assert row.delivery_status == "sent"
    assert row.http_status == 204
    assert row.alert_type == "stream_paused"
    assert row.stream_id == 42
    assert row.fingerprint
    assert row.webhook_url_masked is not None
    # Mask removes query secrets and path detail
    assert "token=xyz" not in (row.webhook_url_masked or "")
    assert "<redacted>" in (row.webhook_url_masked or "")


def test_deliver_alert_failure_persists_history_with_error(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_webhook(db_session, url="https://broken.example.test/h")

    class _Resp:
        status_code = 500

    class _Client:
        def __init__(self, *_a: Any, **_kw: Any) -> None:
            pass

        def __enter__(self) -> "_Client":
            return self

        def __exit__(self, *_a: Any) -> None:
            return None

        def post(self, *_a: Any, **_kw: Any) -> _Resp:
            return _Resp()

    monkeypatch.setattr(httpx, "Client", _Client)

    result = deliver_alert(
        db_session,
        AlertEvent(
            alert_type="destination_failed",
            message="Webhook returns 500",
            stream_id=1,
            stream_name="S1",
        ),
    )
    assert result.delivered is False
    assert result.delivery_status == "failed"
    assert result.http_status == 500
    history = db_session.query(PlatformAlertHistory).filter(PlatformAlertHistory.id == result.history_id).one()
    assert history.delivery_status == "failed"
    assert history.error_message and "HTTP 500" in history.error_message


def test_deliver_alert_cooldown_skips_duplicate(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_webhook(db_session, cooldown=900)
    captured = _setup_httpx_capture(monkeypatch)

    event = AlertEvent(
        alert_type="checkpoint_stalled",
        message="checkpoint stuck",
        stream_id=21,
        stream_name="S21",
    )
    first = deliver_alert(db_session, event)
    second = deliver_alert(db_session, event)
    assert first.delivered is True
    assert second.delivered is False
    assert second.delivery_status == "cooldown_skipped"
    assert second.cooldown_skipped is True
    assert len(captured) == 1  # second delivery was skipped server-side

    rows = (
        db_session.query(PlatformAlertHistory)
        .filter(PlatformAlertHistory.stream_id == 21)
        .order_by(PlatformAlertHistory.id.asc())
        .all()
    )
    statuses = [r.delivery_status for r in rows]
    assert statuses == ["sent", "cooldown_skipped"]


def test_deliver_alert_rule_disabled_persists_skip(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    row = _configure_webhook(db_session)
    row.rules_json = [
        {"alert_type": "high_retry_count", "enabled": False, "severity": "WARNING", "last_triggered_at": None}
    ]
    db_session.commit()
    captured = _setup_httpx_capture(monkeypatch)

    result = deliver_alert(
        db_session,
        AlertEvent(
            alert_type="high_retry_count",
            message="too many retries",
        ),
    )
    assert result.delivered is False
    assert result.delivery_status == "rule_disabled"
    assert result.rule_disabled is True
    assert captured == []


def test_deliver_alert_no_webhook_configured(db_session: Session) -> None:
    row = get_alert_settings_row(db_session)
    row.webhook_url = None
    db_session.commit()

    result = deliver_alert(
        db_session,
        AlertEvent(alert_type="stream_paused", message="x"),
    )
    assert result.delivered is False
    assert result.delivery_status == "not_configured"
    assert result.history_id > 0


def test_force_dispatch_bypasses_cooldown(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_webhook(db_session, cooldown=3600)
    captured = _setup_httpx_capture(monkeypatch)

    event = AlertEvent(alert_type="stream_paused", message="m", stream_id=5)
    deliver_alert(db_session, event)
    deliver_alert(db_session, event)  # cooldown skips
    forced = deliver_alert(db_session, event, force=True)
    assert forced.delivered is True
    assert len(captured) == 2  # forced call still hits webhook


def test_alert_settings_test_endpoint(client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_webhook(db_session)
    captured = _setup_httpx_capture(monkeypatch)

    r = client.post(
        "/api/v1/admin/alert-settings/test",
        json={"alert_type": "stream_paused", "message": "From admin UI"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["delivery_status"] == "sent"
    assert body["history_id"] > 0
    assert len(captured) == 1
    assert captured[0]["json"]["message"] == "From admin UI"


def test_alert_history_endpoint(client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_webhook(db_session)
    _setup_httpx_capture(monkeypatch)
    for i in range(3):
        deliver_alert(
            db_session,
            AlertEvent(alert_type="stream_paused", message=f"e{i}", stream_id=100 + i),
        )
    r = client.get("/api/v1/admin/alert-history?limit=10")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] >= 3
    assert {it["alert_type"] for it in body["items"]} >= {"stream_paused"}


def test_alert_history_filters_by_alert_type(client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_webhook(db_session)
    _setup_httpx_capture(monkeypatch)
    deliver_alert(db_session, AlertEvent(alert_type="stream_paused", message="a", stream_id=1))
    deliver_alert(db_session, AlertEvent(alert_type="destination_failed", message="b", stream_id=2))
    r = client.get("/api/v1/admin/alert-history?alert_type=destination_failed")
    assert r.status_code == 200
    items = r.json()["items"]
    assert items and all(it["alert_type"] == "destination_failed" for it in items)


def test_failed_alert_does_not_affect_stream(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """Failed alert delivery must NOT modify Stream / Route / Checkpoint state."""

    connector = Connector(name="alert-c", description=None, status="RUNNING")
    db_session.add(connector)
    db_session.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={},
        auth_json={},
        enabled=True,
    )
    db_session.add(source)
    db_session.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="alert-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db_session.add(stream)
    db_session.flush()
    dest = Destination(
        name="alert-d",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://x.example/h"},
        rate_limit_json={},
        enabled=True,
    )
    db_session.add(dest)
    db_session.flush()
    route = Route(
        stream_id=stream.id,
        destination_id=dest.id,
        enabled=True,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    db_session.add(route)
    cp = Checkpoint(
        stream_id=stream.id,
        checkpoint_type="CUSTOM_FIELD",
        checkpoint_value_json={"c": 99},
    )
    db_session.add(cp)
    db_session.commit()

    _configure_webhook(db_session)

    class _BrokenClient:
        def __init__(self, *_a: Any, **_kw: Any) -> None:
            pass

        def __enter__(self) -> "_BrokenClient":
            return self

        def __exit__(self, *_a: Any) -> None:
            return None

        def post(self, *_a: Any, **_kw: Any):
            raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx, "Client", _BrokenClient)

    result = deliver_alert(
        db_session,
        AlertEvent(
            alert_type="destination_failed",
            message="forced failure",
            stream_id=stream.id,
            stream_name=str(stream.name),
            route_id=route.id,
            destination_id=dest.id,
        ),
    )
    assert result.delivered is False
    assert result.delivery_status == "failed"

    db_session.expire_all()
    refreshed_stream = db_session.query(Stream).filter(Stream.id == stream.id).one()
    refreshed_route = db_session.query(Route).filter(Route.id == route.id).one()
    refreshed_cp = db_session.query(Checkpoint).filter(Checkpoint.stream_id == stream.id).one()
    assert refreshed_stream.enabled is True
    assert refreshed_stream.status == "RUNNING"
    assert refreshed_route.enabled is True
    assert dict(refreshed_cp.checkpoint_value_json or {}) == {"c": 99}


def test_mask_webhook_url_handles_query_and_path() -> None:
    masked = mask_webhook_url("https://hooks.example.test/path/secret?token=abc")
    assert masked is not None
    assert "<redacted>" in masked
    assert "secret" not in masked
    assert "abc" not in masked


def test_monitor_detects_stream_pause_transition(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    connector = Connector(name="m-c", description=None, status="RUNNING")
    db_session.add(connector)
    db_session.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={},
        auth_json={},
        enabled=True,
    )
    db_session.add(source)
    db_session.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="m-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db_session.add(stream)
    db_session.commit()

    _configure_webhook(db_session)
    _setup_httpx_capture(monkeypatch)

    monitor = PlatformAlertMonitor()
    # First sweep observes RUNNING — no event.
    first = monitor.trigger_once()
    assert all(ev.alert_type != "stream_paused" for ev in first)

    stream.enabled = False
    db_session.commit()
    events = monitor.trigger_once()
    types = [ev.alert_type for ev in events]
    assert "stream_paused" in types


def test_monitor_detects_high_retry_count(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    connector = Connector(name="m-rc", description=None, status="RUNNING")
    db_session.add(connector)
    db_session.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={},
        auth_json={},
        enabled=True,
    )
    db_session.add(source)
    db_session.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="m-rc-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db_session.add(stream)
    db_session.flush()
    dest = Destination(
        name="m-rc-d",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://x.example/h"},
        rate_limit_json={},
        enabled=True,
    )
    db_session.add(dest)
    db_session.flush()
    route = Route(
        stream_id=stream.id,
        destination_id=dest.id,
        enabled=True,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    db_session.add(route)
    db_session.commit()

    now = datetime.now(UTC)
    for i in range(12):
        db_session.add(
            DeliveryLog(
                connector_id=connector.id,
                stream_id=stream.id,
                route_id=route.id,
                destination_id=dest.id,
                stage="route_retry_failed",
                level="WARN",
                status="RETRY",
                message="rt",
                payload_sample={},
                retry_count=1,
                http_status=503,
                latency_ms=12,
                error_code="RETRY",
                created_at=now - timedelta(minutes=i),
            )
        )
    db_session.commit()

    _configure_webhook(db_session)
    _setup_httpx_capture(monkeypatch)

    monitor = PlatformAlertMonitor()
    events = monitor.trigger_once()
    types = [ev.alert_type for ev in events]
    assert "high_retry_count" in types
