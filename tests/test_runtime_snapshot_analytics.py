"""Snapshot-backed runtime dashboard and retry analytics (Phase 5)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.connectors.models import Connector
from app.database import get_db
from app.destinations.models import Destination
from app.logs.models import DeliveryLog
from app.main import app
from app.routes.models import Route
from app.runtime.dashboard_read_cache import clear_dashboard_read_cache
from app.runtime.models import RuntimeRouteSnapshot, RuntimeStreamSnapshot
from app.runtime.runtime_snapshot_repository import recompute_and_upsert_snapshots
from app.sources.models import Source
from app.streams.models import Stream

UTC = timezone.utc


@pytest.fixture(autouse=True)
def _clear_dashboard_cache() -> None:
    clear_dashboard_read_cache()
    yield


def _seed(db: Session) -> dict[str, int]:
    connector = Connector(name="snap-analytics", description=None, status="RUNNING")
    db.add(connector)
    db.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={},
        auth_json={},
        enabled=True,
    )
    db.add(source)
    db.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="snap-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db.add(stream)
    db.flush()
    destination = Destination(
        name="snap-dest",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://example.invalid/hook"},
        rate_limit_json={},
        enabled=True,
    )
    db.add(destination)
    db.flush()
    route = Route(
        stream_id=stream.id,
        destination_id=destination.id,
        enabled=True,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    db.add(route)
    db.flush()
    t = datetime.now(UTC) - timedelta(minutes=2)
    for stage in ("route_send_success", "route_send_failed", "route_retry_success"):
        db.add(
            DeliveryLog(
                connector_id=connector.id,
                stream_id=stream.id,
                route_id=route.id,
                destination_id=destination.id,
                stage=stage,
                level="INFO",
                status="OK",
                message="evt",
                payload_sample={"event_count": 2},
                retry_count=1 if "retry" in stage else 0,
                created_at=t,
            )
        )
    db.commit()
    recompute_and_upsert_snapshots(db, scan_minutes=15)
    db.commit()
    return {
        "stream_id": int(stream.id),
        "route_id": int(route.id),
        "destination_id": int(destination.id),
    }


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_dashboard_summary_reads_snapshot_tables(
    client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _seed(db_session)
    assert db_session.query(RuntimeStreamSnapshot).count() >= 1
    assert db_session.query(RuntimeRouteSnapshot).count() >= 1

    def _forbid_delivery_logs_aggregate(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("delivery_logs aggregate must not run when snapshot read model is populated")

    monkeypatch.setattr(
        "app.runtime.read_service.summarize_delivery_outcomes",
        _forbid_delivery_logs_aggregate,
    )
    monkeypatch.setattr(
        "app.runtime.read_service.list_recent_delivery_logs_global_since",
        _forbid_delivery_logs_aggregate,
    )

    response = client.get("/api/v1/runtime/dashboard/summary", params={"window": "1h", "limit": 50})
    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["total_streams"] >= 1
    assert body["summary"]["delivery_outcome_events"] >= 0


def test_retry_summary_bounded_snapshot_query(
    client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _seed(db_session)

    def _forbid_legacy(*_args: Any, **_kwargs: Any) -> tuple[int, int, int]:
        raise AssertionError("legacy delivery_logs retry aggregate must not run")

    monkeypatch.setattr("app.runtime.analytics_repository.fetch_retry_summary", _forbid_legacy)

    response = client.get("/api/v1/runtime/analytics/retries/summary", params={"window": "1h"})
    assert response.status_code == 200
    body = response.json()
    assert "retry_success_events" in body
    assert "retry_failed_events" in body
    assert body["total_retry_outcome_events"] == body["retry_success_events"] + body["retry_failed_events"]


def test_outcome_timeseries_operational_snapshot_window(client: TestClient, db_session: Session) -> None:
    _seed(db_session)
    response = client.get(
        "/api/v1/runtime/dashboard/outcome-timeseries",
        params={"window": "1h"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["buckets"]
    assert len(body["buckets"]) >= 1
