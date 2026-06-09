"""OSS v1.0.1 Sprint 9 — cumulative KPI cache and replay rate limiter."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.destinations.models import Destination
from app.logs.incremental_aggregates import clear_incremental_delivery_log_aggregate_cache
from app.logs.models import DeliveryLog
from app.rate_limit.process_destination_limiter import reset_process_destination_rate_limiter_for_tests
from app.replay.models import REPLAY_STATUS_PENDING, StreamReplayEvent
from app.replay.service import REPLAY_DESTINATION_RATE_LIMITED, ReplayEventStateError, execute_replay_event
from app.routes.models import Route
from app.runtime.aggregate_summaries import summarize_delivery_outcomes
from app.runtime.cumulative_metrics_cache import get_window_kpi_counts
from tests.test_stream_runner_e2e import (
    _FakePoller,
    _FakeWebhookSender,
    _build_runner,
    _seed_stream_runtime,
)
from app.runners.stream_loader import load_stream_context


@pytest.fixture(autouse=True)
def _reset_operational_caches() -> None:
    clear_incremental_delivery_log_aggregate_cache()
    reset_process_destination_rate_limiter_for_tests()
    yield
    clear_incremental_delivery_log_aggregate_cache()
    reset_process_destination_rate_limiter_for_tests()


def _count_db_queries(db_session: Session, fn: Any) -> tuple[Any, int]:
    engine = db_session.get_bind()
    count = {"n": 0}

    def _before(_conn: object, _cursor: object, _statement: str, _parameters: object, _context: object, _executemany: bool) -> None:
        stmt = str(_statement).lower()
        if "delivery_logs" in stmt and "count" not in stmt and "max" not in stmt:
            count["n"] += 1

    event.listen(engine, "before_cursor_execute", _before)
    try:
        result = fn()
        return result, int(count["n"])
    finally:
        event.remove(engine, "before_cursor_execute", _before)


def test_run_complete_ingest_warm_cache_reduces_delivery_log_scans(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    context = load_stream_context(db_session, seeded["stream_id"])
    poller = _FakePoller(
        response={"items": [{"id": "s9-evt-1", "message": "kpi", "vendor": "MappedVendor"}]}
    )
    runner = _build_runner(poller=poller, webhook_sender=_FakeWebhookSender())
    runner.run(context, db=db_session)

    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=1)

    # Prime cache from ingested rows.
    get_window_kpi_counts(db_session, since=since, until=now + timedelta(seconds=1))

    _, scan_queries = _count_db_queries(
        db_session,
        lambda: get_window_kpi_counts(db_session, since=since, until=now + timedelta(seconds=1)),
    )
    assert scan_queries == 0


def test_cumulative_kpi_counts_match_delivery_outcomes(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    context = load_stream_context(db_session, seeded["stream_id"])
    poller = _FakePoller(
        response={"items": [{"id": "s9-evt-2", "message": "kpi2", "vendor": "MappedVendor"}]}
    )
    runner = _build_runner(poller=poller, webhook_sender=_FakeWebhookSender())
    runner.run(context, db=db_session)

    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=1)
    until = now + timedelta(seconds=1)
    kpis = get_window_kpi_counts(db_session, since=since, until=until)
    outcomes = summarize_delivery_outcomes(db_session, start_at=since, end_at=until)
    assert kpis["success_count"] == outcomes.success_events
    assert kpis["failure_count"] == outcomes.failure_events


def test_replay_respects_destination_rate_limiter(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    destination_id = int(seeded["destination_ids"][0])
    route_id = int(seeded["route_ids"][0])

    destination = db_session.get(Destination, destination_id)
    assert destination is not None
    destination.rate_limit_json = {"max_events": 1, "per_seconds": 60}
    route = db_session.get(Route, route_id)
    assert route is not None
    route.rate_limit_json = {"max_events": 1, "per_seconds": 60}
    db_session.commit()

    now = datetime.now(timezone.utc)
    rows: list[StreamReplayEvent] = []
    for idx in range(3):
        row = StreamReplayEvent(
            stream_id=stream_id,
            destination_id=destination_id,
            route_id=route_id,
            delivery_kind="base_route",
            status=REPLAY_STATUS_PENDING,
            protected_payload_json={"events": [{"id": idx}]},
            delivery_context_json={"destination_type": "WEBHOOK_POST"},
            event_count=1,
            created_at=now,
            updated_at=now,
        )
        db_session.add(row)
        rows.append(row)
    db_session.commit()

    class _CountingSender:
        calls = 0

        def send(self, *args: Any, **kwargs: Any) -> None:
            _CountingSender.calls += 1

    from app.destinations.adapters.registry import DestinationAdapterRegistry

    registry = DestinationAdapterRegistry(webhook_sender=_CountingSender(), syslog_sender=_CountingSender())

    execute_replay_event(db_session, int(rows[0].id), destination_registry=registry)
    db_session.commit()

    with pytest.raises(ReplayEventStateError) as exc:
        execute_replay_event(db_session, int(rows[1].id), destination_registry=registry)
    assert exc.value.error_code == REPLAY_DESTINATION_RATE_LIMITED
    assert _CountingSender.calls == 1
