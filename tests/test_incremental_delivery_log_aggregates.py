"""Incremental delivery_logs aggregates match the existing full aggregate path."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.destinations.models import Destination
from app.logs.incremental_aggregates import clear_incremental_delivery_log_aggregate_cache
from app.logs.aggregates import (
    aggregate_delivery_outcome_totals,
    aggregate_platform_outcome_buckets,
    aggregate_stream_delivery_buckets,
)
from app.logs.models import DeliveryLog
from app.routes.models import Route
from app.runtime import analytics_repository
from app.sources.models import Source
from app.streams.models import Stream

UTC = timezone.utc


@pytest.fixture(autouse=True)
def _clear_incremental_cache() -> None:
    clear_incremental_delivery_log_aggregate_cache()
    yield
    clear_incremental_delivery_log_aggregate_cache()


def _seed_hierarchy(db: Session) -> dict[str, int]:
    connector = Connector(name="inc-conn", description=None, status="RUNNING")
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
        name="inc-stream",
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
        name="inc-dest",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://inc.example.invalid/h"},
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
    db.add(Checkpoint(stream_id=stream.id, checkpoint_type="CUSTOM_FIELD", checkpoint_value_json={}))
    db.commit()
    return {
        "connector_id": int(connector.id),
        "stream_id": int(stream.id),
        "route_id": int(route.id),
        "destination_id": int(destination.id),
    }


def _log(
    db: Session,
    *,
    ids: dict[str, int],
    stage: str,
    created_at: datetime,
    payload_sample: dict[str, Any] | None = None,
    latency_ms: int | None = None,
    retry_count: int = 0,
    level: str = "INFO",
) -> None:
    route_scoped = stage.startswith("route_")
    db.add(
        DeliveryLog(
            connector_id=ids["connector_id"],
            stream_id=ids["stream_id"],
            route_id=ids["route_id"] if route_scoped else None,
            destination_id=ids["destination_id"] if route_scoped else None,
            stage=stage,
            level=level,
            status="OK",
            message=stage,
            payload_sample=payload_sample or {},
            retry_count=retry_count,
            latency_ms=latency_ms,
            created_at=created_at,
        )
    )


def test_incremental_delivery_log_aggregates_match_full_fallback(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ids = _seed_hierarchy(db_session)
    now = datetime.now(UTC).replace(microsecond=0)
    start = now - timedelta(hours=1)
    base = start + timedelta(minutes=10)
    _log(db_session, ids=ids, stage="run_complete", created_at=base, payload_sample={"input_events": 8})
    _log(
        db_session,
        ids=ids,
        stage="route_send_success",
        created_at=base + timedelta(seconds=10),
        payload_sample={"event_count": 5},
        latency_ms=40,
    )
    _log(
        db_session,
        ids=ids,
        stage="route_retry_success",
        created_at=base + timedelta(seconds=20),
        payload_sample={"event_count": 2},
        latency_ms=70,
        retry_count=1,
    )
    _log(
        db_session,
        ids=ids,
        stage="route_send_failed",
        created_at=base + timedelta(minutes=5),
        payload_sample={"event_count": 3},
        retry_count=2,
    )
    _log(
        db_session,
        ids=ids,
        stage="route_send_success",
        created_at=base + timedelta(minutes=15),
        payload_sample={"event_count": 99},
        level="DEBUG",
    )
    db_session.commit()

    incremental_totals = aggregate_delivery_outcome_totals(db_session, start_at=start, end_at=now)
    incremental_platform = aggregate_platform_outcome_buckets(
        db_session,
        start_at=start,
        end_at=now,
        bucket_seconds=300,
    )
    incremental_stream = aggregate_stream_delivery_buckets(
        db_session,
        stream_id=ids["stream_id"],
        start_at=start,
        end_at=now,
        bucket_seconds=300,
    )
    incremental_routes = analytics_repository.fetch_route_outcome_rows(
        db_session,
        since=start,
        until=now,
        stream_id=None,
        route_id=None,
        destination_id=None,
    )

    monkeypatch.setattr(
        "app.logs.aggregates.incremental.delivery_outcome_totals",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("force full aggregate")),
    )
    full_totals = aggregate_delivery_outcome_totals(db_session, start_at=start, end_at=now)
    monkeypatch.setattr(
        "app.logs.aggregates.incremental.delivery_log_aggregate_facts",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("force full aggregate")),
    )
    full_platform = aggregate_platform_outcome_buckets(
        db_session,
        start_at=start,
        end_at=now,
        bucket_seconds=300,
    )
    full_stream = aggregate_stream_delivery_buckets(
        db_session,
        stream_id=ids["stream_id"],
        start_at=start,
        end_at=now,
        bucket_seconds=300,
    )
    monkeypatch.setattr(
        "app.runtime.analytics_repository.incremental.route_outcome_rows",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("force full aggregate")),
    )
    full_routes = analytics_repository.fetch_route_outcome_rows(
        db_session,
        since=start,
        until=now,
        stream_id=None,
        route_id=None,
        destination_id=None,
    )

    assert incremental_totals == full_totals
    assert incremental_platform == full_platform
    assert incremental_stream == full_stream
    assert [(r.route_id, r.failure_count, r.success_count) for r in incremental_routes] == [
        (r.route_id, r.failure_count, r.success_count) for r in full_routes
    ]
