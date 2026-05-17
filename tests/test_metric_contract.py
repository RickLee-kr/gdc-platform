"""Metric ontology contract and shared aggregate semantics."""

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
from app.runtime.aggregate_summaries import (
    summarize_delivery_outcomes,
    summarize_log_rows,
    summarize_processed_events,
)
from app.runtime.metric_contract import METRIC_CONTRACT
from app.sources.models import Source
from app.streams.models import Stream

UTC = timezone.utc


def _seed_topology(db: Session) -> dict[str, int]:
    connector = Connector(name="metric-contract-connector", description=None, status="RUNNING")
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
        name="metric-contract-stream",
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
        name="metric-contract-destination",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://metrics.example/hook"},
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
    return {
        "connector_id": int(connector.id),
        "stream_id": int(stream.id),
        "route_id": int(route.id),
        "destination_id": int(dest.id),
    }


def _log(
    db: Session,
    ids: dict[str, int],
    *,
    stage: str,
    created_at: datetime,
    level: str = "INFO",
    payload_sample: dict[str, Any] | None = None,
) -> None:
    db.add(
        DeliveryLog(
            connector_id=ids["connector_id"],
            stream_id=ids["stream_id"],
            route_id=ids["route_id"] if stage != "run_complete" else None,
            destination_id=ids["destination_id"] if stage != "run_complete" else None,
            stage=stage,
            level=level,
            status="OK",
            message=stage,
            payload_sample=payload_sample or {},
            retry_count=0,
            created_at=created_at,
        )
    )


def test_required_metric_ids_are_registered() -> None:
    required = {
        "current_runtime.healthy_streams",
        "current_runtime.failed_routes",
        "processed_events.window",
        "delivery_outcomes.window",
        "delivery_outcomes.success",
        "delivery_outcomes.failure",
        "runtime_telemetry_rows.window",
        "historical_health.routes",
        "historical_health.streams",
        "route_config.total",
        "route_config.enabled",
        "route_config.disabled",
        "runtime.throughput.processed_events_per_second",
        "routes.throughput.delivery_outcomes_per_second",
    }
    assert required.issubset(METRIC_CONTRACT.keys())


def test_shared_aggregate_helpers_use_distinct_contract_formulas(db_session: Session) -> None:
    ids = _seed_topology(db_session)
    start = datetime.now(UTC) - timedelta(hours=1)
    end = datetime.now(UTC) + timedelta(minutes=1)
    t = start + timedelta(minutes=5)

    _log(db_session, ids, stage="run_complete", created_at=t, payload_sample={"input_events": 11})
    _log(db_session, ids, stage="route_send_success", created_at=t, payload_sample={"event_count": 3})
    _log(db_session, ids, stage="route_retry_success", created_at=t, payload_sample={"event_count": 2})
    _log(db_session, ids, stage="route_send_failed", created_at=t, payload_sample={"event_count": 5})
    _log(db_session, ids, stage="source_rate_limited", created_at=t, payload_sample={"event_count": 99})
    _log(db_session, ids, stage="route_skip", created_at=t, payload_sample={"event_count": 99})
    db_session.commit()

    processed = summarize_processed_events(db_session, start_at=start, end_at=end, stream_id=ids["stream_id"])
    outcomes = summarize_delivery_outcomes(db_session, start_at=start, end_at=end, stream_id=ids["stream_id"])
    rows = summarize_log_rows(db_session, start_at=start, end_at=end, stream_id=ids["stream_id"])

    assert processed.metric_id == "processed_events.window"
    assert processed.meta["metric_id"] == processed.metric_id
    assert processed.processed_events == 11

    assert outcomes.metric_id == "delivery_outcomes.window"
    assert outcomes.meta["metric_id"] == outcomes.metric_id
    assert outcomes.success_events == 5
    assert outcomes.failure_events == 5
    assert outcomes.total_events == 10

    assert rows.metric_id == "runtime_telemetry_rows.window"
    assert rows.meta["metric_id"] == rows.metric_id
    assert rows.meta["semantic_type"] == "telemetry_rows"
    assert rows.meta["includes_lifecycle_rows"] is True
    assert rows.total_rows == 6
    assert "telemetry rows including lifecycle stages" in rows.meta["description"]


def test_runtime_api_responses_include_metric_meta_and_window_bounds(db_session: Session) -> None:
    ids = _seed_topology(db_session)
    _log(
        db_session,
        ids,
        stage="run_complete",
        created_at=datetime.now(UTC) - timedelta(minutes=5),
        payload_sample={"input_events": 7},
    )
    db_session.commit()

    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        client = TestClient(app)
        dashboard = client.get("/api/v1/runtime/dashboard/summary", params={"window": "1h"}).json()
        assert dashboard["metric_meta"]["processed_events.window"]["metric_id"] == "processed_events.window"
        assert dashboard["metric_meta"]["runtime_telemetry_rows.window"]["description"].startswith("Committed delivery_logs")
        assert dashboard["metric_meta"]["runtime_telemetry_rows.window"]["window_start"] is not None
        assert dashboard["metric_meta"]["runtime_telemetry_rows.window"]["window_end"] is not None
        assert dashboard["window_start"] is not None
        assert dashboard["window_end"] is not None

        metrics = client.get(f"/api/v1/runtime/streams/{ids['stream_id']}/metrics", params={"window": "1h"}).json()
        assert metrics["metric_meta"]["processed_events.window"]["metric_id"] == "processed_events.window"
        assert metrics["kpis"]["metric_meta"]["delivery_outcomes.window"]["metric_id"] == "delivery_outcomes.window"

        analytics = client.get("/api/v1/runtime/analytics/routes/failures", params={"window": "24h"}).json()
        assert analytics["metric_meta"]["delivery_outcomes.window"]["metric_id"] == "delivery_outcomes.window"
        assert analytics["time"]["window_start"] is not None
        assert analytics["time"]["window_end"] is not None
    finally:
        app.dependency_overrides.pop(get_db, None)
