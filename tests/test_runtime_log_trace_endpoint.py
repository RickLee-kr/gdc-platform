"""Delivery log execution trace API — read-only correlation timeline."""

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
from app.sources.models import Source
from app.streams.models import Stream

UTC = timezone.utc


def _seed(db: Session) -> dict[str, int]:
    connector = Connector(name="trace-connector", description=None, status="RUNNING")
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
        name="trace-stream",
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
        name="trace-d1",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://x.example/h"},
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
    db.commit()
    db.refresh(stream)
    db.refresh(route)
    return {"stream_id": stream.id, "route_id": route.id, "destination_id": dest.id, "connector_id": connector.id}


def _add_row(
    db: Session,
    *,
    stream_id: int,
    run_id: str | None,
    stage: str,
    route_id: int | None,
    destination_id: int | None,
    created_at: datetime,
    connector_id: int | None = None,
) -> DeliveryLog:
    row = DeliveryLog(
        connector_id=connector_id,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        stage=stage,
        level="INFO",
        status="OK",
        message=stage,
        payload_sample={"stage": stage},
        retry_count=0,
        http_status=None,
        latency_ms=None,
        error_code=None,
        run_id=run_id,
        created_at=created_at,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@pytest.fixture()
def trace_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_trace_by_run_orders_timeline_and_filters_run(trace_client: TestClient, db_session: Session) -> None:
    ids = _seed(db_session)
    base = datetime.now(tz=UTC)
    run_a = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeaaaa"
    run_b = "bbbbbbbb-cccc-dddd-eeee-ffffffffbbbb"

    _add_row(
        db_session,
        stream_id=ids["stream_id"],
        run_id=run_a,
        stage="source_fetch",
        route_id=None,
        destination_id=None,
        created_at=base,
        connector_id=ids["connector_id"],
    )
    _add_row(
        db_session,
        stream_id=ids["stream_id"],
        run_id=run_a,
        stage="run_complete",
        route_id=None,
        destination_id=None,
        created_at=base + timedelta(seconds=2),
        connector_id=ids["connector_id"],
    )
    _add_row(
        db_session,
        stream_id=ids["stream_id"],
        run_id=run_b,
        stage="source_fetch",
        route_id=None,
        destination_id=None,
        created_at=base + timedelta(seconds=10),
        connector_id=ids["connector_id"],
    )

    res = trace_client.get(f"/api/v1/runtime/runs/{run_a}/trace")
    assert res.status_code == 200
    body = res.json()
    assert body["run_id"] == run_a
    stages = [e["stage"] for e in body["timeline"]]
    assert stages == ["source_fetch", "run_complete"]

    res_other = trace_client.get(f"/api/v1/runtime/runs/{run_b}/trace")
    assert res_other.status_code == 200
    assert len(res_other.json()["timeline"]) == 1


def test_trace_by_log_returns_single_row_when_run_id_null(trace_client: TestClient, db_session: Session) -> None:
    ids = _seed(db_session)
    row = _add_row(
        db_session,
        stream_id=ids["stream_id"],
        run_id=None,
        stage="route_send_success",
        route_id=ids["route_id"],
        destination_id=ids["destination_id"],
        created_at=datetime.now(tz=UTC),
        connector_id=ids["connector_id"],
    )

    res = trace_client.get(f"/api/v1/runtime/logs/{row.id}/trace")
    assert res.status_code == 200
    body = res.json()
    assert body["run_id"] is None
    assert len(body["timeline"]) == 1
    assert body["timeline"][0]["id"] == row.id


def test_trace_unknown_run_returns_404(trace_client: TestClient, db_session: Session) -> None:
    _seed(db_session)
    res = trace_client.get("/api/v1/runtime/runs/00000000-0000-0000-0000-000000000099/trace")
    assert res.status_code == 404


def test_trace_unknown_log_returns_404(trace_client: TestClient, db_session: Session) -> None:
    _seed(db_session)
    res = trace_client.get("/api/v1/runtime/logs/999999999/trace")
    assert res.status_code == 404
