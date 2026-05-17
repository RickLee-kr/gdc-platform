"""Snapshot alignment for KPI and chart responses."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.database import get_db
from app.destinations.models import Destination
from app.logs.models import DeliveryLog
from app.main import app
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream

UTC = timezone.utc


def _seed(db: Session) -> dict[str, int]:
    connector = Connector(name="chart-snapshot-connector", description=None, status="RUNNING")
    db.add(connector)
    db.flush()
    source = Source(connector_id=connector.id, source_type="HTTP_API_POLLING", config_json={}, auth_json={}, enabled=True)
    db.add(source)
    db.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="chart-snapshot-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db.add(stream)
    db.flush()
    dest = Destination(
        name="chart-snapshot-destination",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://charts.example/hook"},
        rate_limit_json={},
        enabled=True,
    )
    db.add(dest)
    db.flush()
    route = Route(
        stream_id=stream.id,
        destination_id=dest.id,
        enabled=True,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    db.add(route)
    db.add(Checkpoint(stream_id=stream.id, checkpoint_type="CUSTOM_FIELD", checkpoint_value_json={}))
    db.commit()
    return {"connector_id": connector.id, "stream_id": stream.id, "route_id": route.id, "destination_id": dest.id}


def _log(db: Session, ids: dict[str, int], *, stage: str, created_at: datetime, payload_sample: dict[str, Any]) -> None:
    db.add(
        DeliveryLog(
            connector_id=ids["connector_id"],
            stream_id=ids["stream_id"],
            route_id=ids["route_id"] if stage != "run_complete" else None,
            destination_id=ids["destination_id"] if stage != "run_complete" else None,
            stage=stage,
            level="INFO",
            status="OK",
            message=stage,
            payload_sample=payload_sample,
            retry_count=0,
            created_at=created_at,
        )
    )


def test_chart_apis_reuse_snapshot_window_and_bucket_set(db_session: Session) -> None:
    ids = _seed(db_session)
    snapshot_id = "2026-01-01T01:00:00+00:00"
    event_time = datetime(2026, 1, 1, 0, 55, tzinfo=UTC)
    _log(db_session, ids, stage="run_complete", created_at=event_time, payload_sample={"input_events": 10})
    _log(db_session, ids, stage="route_send_success", created_at=event_time, payload_sample={"event_count": 10})
    db_session.commit()

    def _override_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        client = TestClient(app)
        dashboard = client.get(
            "/api/v1/runtime/dashboard/outcome-timeseries",
            params={"window": "1h", "snapshot_id": snapshot_id},
        ).json()
        stream = client.get(
            f"/api/v1/runtime/streams/{ids['stream_id']}/metrics",
            params={"window": "1h", "snapshot_id": snapshot_id},
        ).json()
        analytics = client.get(
            "/api/v1/runtime/analytics/routes/failures",
            params={"window": "1h", "snapshot_id": snapshot_id},
        ).json()
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert dashboard["snapshot_id"] == snapshot_id
    assert stream["snapshot_id"] == snapshot_id
    assert analytics["time"]["snapshot_id"] == snapshot_id
    assert dashboard["window_start"] == stream["window_start"] == analytics["time"]["window_start"]
    assert dashboard["window_end"] == stream["window_end"] == analytics["time"]["window_end"]
    assert dashboard["bucket_size_seconds"] == stream["bucket_size_seconds"] == analytics["bucket_size_seconds"] == 150
    assert dashboard["bucket_count"] == stream["bucket_count"] == analytics["bucket_count"] == 24

