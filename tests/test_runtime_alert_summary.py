"""Runtime Alert Summary timeout-safe / degraded behavior."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.logs.models import DeliveryLog
from app.runtime import read_service
from tests.test_stream_runner_e2e import _seed_stream_runtime


def test_runtime_alert_summary_happy_path(runtime_api_client: TestClient, db_session: Session) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    now = datetime.now(timezone.utc)
    db_session.add(
        DeliveryLog(
            stream_id=stream_id,
            stage="route_send_failed",
            level="ERROR",
            status="FAILED",
            message="alert summary seed",
            payload_sample={},
            retry_count=0,
            created_at=now - timedelta(minutes=5),
        )
    )
    db_session.commit()

    res = runtime_api_client.get("/api/v1/runtime/logs/alerts/summary?window=1h&limit=50")
    assert res.status_code == 200
    body = res.json()
    assert body["degraded"] is False
    assert body["metrics_window_seconds"] == 3600
    assert isinstance(body["items"], list)
    assert any(int(i["stream_id"]) == stream_id and i["severity"] == "ERROR" for i in body["items"])


def test_runtime_alert_summary_degrades_on_statement_timeout(
    runtime_api_client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    db_session.commit()

    def _boom(*_args, **_kwargs):
        raise OperationalError("statement timeout", {}, Exception("canceling statement due to statement timeout"))

    monkeypatch.setattr(read_service, "aggregate_warn_error_summaries", _boom)

    res = runtime_api_client.get("/api/v1/runtime/logs/alerts/summary?window=1h&limit=50")
    assert res.status_code == 200
    body = res.json()
    assert body["degraded"] is True
    assert body["items"] == []
    assert body["metrics_window_seconds"] == 3600

    # Same session must still serve subsequent requests after degraded path rollback.
    res2 = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/configuration")
    assert res2.status_code == 200


def test_runtime_alert_summary_clamps_lookback_to_24h(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    def _capture(db, *, start_at, end_at, limit):
        captured["start_at"] = start_at
        captured["end_at"] = end_at
        captured["limit"] = limit
        return []

    monkeypatch.setattr(read_service, "aggregate_warn_error_summaries", _capture)
    monkeypatch.setattr(db_session, "execute", lambda *a, **k: None)

    out = read_service.get_runtime_alert_summary(db_session, window="30d", limit=10)
    assert out.degraded is False
    assert out.items == []
    assert isinstance(captured["start_at"], datetime)
    assert isinstance(captured["end_at"], datetime)
    span = captured["end_at"] - captured["start_at"]  # type: ignore[operator]
    assert span <= timedelta(hours=24) + timedelta(seconds=1)
