"""Phase 6: runtime analytics bucket updater, reads, retention."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.config import settings
from app.connectors.models import Connector
from app.destinations.models import Destination
from app.logs.models import DeliveryLog
from app.routes.models import Route
from app.runtime import runtime_analytics_bucket_read_repository as bucket_read
from app.runtime.models import RuntimeAnalyticsBucket1m, RuntimeAnalyticsBucket5m
from app.runtime.runtime_analytics_bucket_repository import (
    analytics_buckets_populated,
    load_bucket_updater_state,
    prune_analytics_buckets,
    recompute_and_upsert_analytics_buckets,
)
from app.runtime.runtime_analytics_bucket_updater import (
    reset_analytics_bucket_overlap_guard_for_tests,
    run_runtime_analytics_bucket_update,
)
from app.sources.models import Source
from app.streams.models import Stream

UTC = timezone.utc


def _seed(db: Session) -> dict[str, int]:
    connector = Connector(name="bucket-conn", description=None, status="RUNNING")
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
        name="bucket-stream",
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
        name="bucket-dest",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://example.test/h"},
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
    db.flush()
    db.add(Checkpoint(stream_id=stream.id, checkpoint_type="CUSTOM_FIELD", checkpoint_value_json={}))
    db.commit()
    return {
        "connector_id": connector.id,
        "stream_id": stream.id,
        "route_id": route.id,
        "destination_id": dest.id,
    }


def _insert_logs(
    db: Session,
    ids: dict[str, int],
    *,
    stage: str,
    count: int,
    base_time: datetime,
) -> None:
    for i in range(count):
        db.add(
            DeliveryLog(
                connector_id=ids["connector_id"],
                stream_id=ids["stream_id"],
                route_id=ids["route_id"],
                destination_id=ids["destination_id"],
                stage=stage,
                level="INFO",
                status="SUCCESS" if "success" in stage else "FAILED",
                message="test",
                payload_sample={"event_count": 1},
                latency_ms=10 + i,
                created_at=base_time + timedelta(seconds=i),
            )
        )
    db.commit()


def _reset_bucket_cursor(db: Session) -> None:
    state = load_bucket_updater_state(db)
    state.last_delivery_log_id = None
    db.commit()


@pytest.fixture(autouse=True)
def _reset_overlap() -> None:
    reset_analytics_bucket_overlap_guard_for_tests()


def test_bucket_updater_aggregates_and_upserts(db_session: Session) -> None:
    db = db_session
    ids = _seed(db)
    now = datetime.now(UTC)
    _insert_logs(db, ids, stage="route_send_success", count=3, base_time=now - timedelta(minutes=2))
    _insert_logs(db, ids, stage="route_send_failed", count=2, base_time=now - timedelta(minutes=1))

    result = recompute_and_upsert_analytics_buckets(db, batch_limit=10_000, bootstrap_minutes=120)
    db.commit()

    assert result.logs_processed >= 5
    assert analytics_buckets_populated(db)

    all_rows = db.query(RuntimeAnalyticsBucket1m).all()
    assert all_rows
    assert sum(r.success_count for r in all_rows) >= 3
    assert sum(r.failure_count for r in all_rows) >= 2

    route_rows = (
        db.query(RuntimeAnalyticsBucket1m)
        .filter(RuntimeAnalyticsBucket1m.route_id == ids["route_id"])
        .all()
    )
    assert route_rows


def test_bucket_updater_incremental_cursor(db_session: Session) -> None:
    db = db_session
    ids = _seed(db)
    now = datetime.now(UTC)
    _insert_logs(db, ids, stage="route_send_success", count=2, base_time=now - timedelta(minutes=1))

    first = recompute_and_upsert_analytics_buckets(db, batch_limit=10_000, bootstrap_minutes=120)
    db.commit()
    assert first.max_log_id is not None

    _insert_logs(db, ids, stage="route_send_failed", count=1, base_time=now)
    second = recompute_and_upsert_analytics_buckets(db, batch_limit=10_000, bootstrap_minutes=120)
    db.commit()

    assert second.logs_processed >= 1
    rows = db.query(RuntimeAnalyticsBucket1m).all()
    assert sum(r.failure_count for r in rows) >= 1


def test_failure_trend_from_buckets(db_session: Session) -> None:
    db = db_session
    _reset_bucket_cursor(db)
    ids = _seed(db)
    now = datetime.now(UTC)
    _insert_logs(db, ids, stage="route_send_failed", count=4, base_time=now - timedelta(hours=1))
    result = recompute_and_upsert_analytics_buckets(db, batch_limit=10_000, bootstrap_minutes=180)
    db.commit()
    assert result.logs_processed >= 4
    stored = db.query(RuntimeAnalyticsBucket1m).all()
    assert sum(r.failure_count for r in stored) >= 4

    since = now - timedelta(hours=24)
    trend = bucket_read.fetch_failure_trend_from_buckets(
        db,
        since=since,
        until=now,
        stream_id=None,
        route_id=None,
        destination_id=None,
        bucket_seconds=300,
        window_seconds=24 * 3600,
    )
    assert trend
    assert sum(t.failure_count for t in trend) >= 4


def test_platform_outcome_rebucket(db_session: Session) -> None:
    db = db_session
    _reset_bucket_cursor(db)
    ids = _seed(db)
    now = datetime.now(UTC)
    _insert_logs(db, ids, stage="route_send_success", count=5, base_time=now - timedelta(minutes=10))
    recompute_and_upsert_analytics_buckets(db, batch_limit=10_000, bootstrap_minutes=180)
    db.commit()

    since = now - timedelta(hours=6)
    raw = bucket_read.fetch_platform_outcome_buckets(
        db, since=since, until=now, window_seconds=6 * 3600
    )
    dense = bucket_read.rebucket_platform_outcomes(
        raw, since=since, until=now, target_bucket_seconds=900, source_bucket_seconds=60
    )
    assert dense
    assert sum(b.success for b in dense) >= 5


def test_retention_prune_bounded(db_session: Session) -> None:
    db = db_session
    ids = _seed(db)
    now = datetime.now(UTC)
    old = now - timedelta(days=40)
    db.add(
        RuntimeAnalyticsBucket1m(
            bucket_start=old,
            stream_id=ids["stream_id"],
            route_id=ids["route_id"],
            destination_id=ids["destination_id"],
            event_count=1,
            success_count=1,
            failure_count=0,
            retry_count=0,
            rate_limited_count=0,
            eps_avg=0.0,
            updated_at=old,
        )
    )
    db.commit()

    result = prune_analytics_buckets(db, retention_1m_days=30, retention_5m_days=90, batch_size=100)
    db.commit()
    assert result.deleted_1m >= 1
    remaining = db.query(RuntimeAnalyticsBucket1m).filter(RuntimeAnalyticsBucket1m.bucket_start == old).count()
    assert remaining == 0


def test_updater_fail_open(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    db = db_session
    monkeypatch.setattr(settings, "GDC_RUNTIME_ANALYTICS_BUCKET_UPDATER_ENABLED", True)

    def _boom(_db: Session) -> Any:
        raise RuntimeError("simulated")

    monkeypatch.setattr(
        "app.runtime.runtime_analytics_bucket_updater.recompute_and_upsert_analytics_buckets",
        _boom,
    )
    outcome = run_runtime_analytics_bucket_update(db)
    assert outcome.error is not None


def test_route_outcomes_and_retry_heavy_from_buckets(db_session: Session) -> None:
    db = db_session
    _reset_bucket_cursor(db)
    ids = _seed(db)
    now = datetime.now(UTC)
    _insert_logs(db, ids, stage="route_retry_success", count=3, base_time=now - timedelta(hours=2))
    recompute_and_upsert_analytics_buckets(db, batch_limit=10_000, bootstrap_minutes=180)
    db.commit()

    since = now - timedelta(hours=24)
    routes = bucket_read.fetch_route_outcomes_from_buckets(
        db,
        since=since,
        until=now,
        stream_id=None,
        route_id=None,
        destination_id=None,
        window_seconds=24 * 3600,
    )
    assert routes
    assert routes[0].route_id == ids["route_id"]

    heavy = bucket_read.fetch_retry_heavy_from_buckets(
        db,
        since=since,
        until=now,
        stream_id=None,
        route_id=None,
        destination_id=None,
        dimension="stream",
        limit=10,
        window_seconds=24 * 3600,
    )
    assert heavy
    assert heavy[0].group_id == ids["stream_id"]
