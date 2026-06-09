"""OSS v1.0.1 Sprint 6 — context cache and run-level timing trace."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.logs.models import DeliveryLog
from app.mappings.models import Mapping
from app.runners.stream_loader import load_stream_context
from app.runners.stream_runner import StreamRunner
from app.scheduler.context_cache import (
    context_cache_metrics,
    invalidate_stream_context_cache,
    load_scheduler_stream_context,
    reset_context_cache_for_tests,
)
from tests.test_stream_runner_e2e import (
    _FakePoller,
    _FakeWebhookSender,
    _build_runner,
    _seed_stream_runtime,
)


@pytest.fixture(autouse=True)
def _reset_context_cache() -> None:
    reset_context_cache_for_tests()


def _count_db_queries(db_session: Session, fn: Any) -> tuple[Any, int]:
    engine = db_session.get_bind()
    count = {"n": 0}

    def _before(_conn: object, _cursor: object, _statement: str, _parameters: object, _context: object, _executemany: bool) -> None:
        count["n"] += 1

    event.listen(engine, "before_cursor_execute", _before)
    try:
        result = fn()
        return result, int(count["n"])
    finally:
        event.remove(engine, "before_cursor_execute", _before)


def test_scheduler_context_cache_hit_reduces_queries(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = seeded["stream_id"]

    _, first_queries = _count_db_queries(
        db_session,
        lambda: load_scheduler_stream_context(db_session, stream_id),
    )
    _, second_queries = _count_db_queries(
        db_session,
        lambda: load_scheduler_stream_context(db_session, stream_id),
    )

    metrics = context_cache_metrics()
    assert metrics["hits"] == 1
    assert metrics["misses"] == 1
    assert second_queries < first_queries


def test_scheduler_context_cache_checkpoint_is_fresh(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = seeded["stream_id"]

    first = load_scheduler_stream_context(db_session, stream_id)
    first_cp = first.checkpoint

    from app.checkpoints.models import Checkpoint

    row = db_session.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).one()
    row.checkpoint_value_json = {"last_event_id": "s6-fresh-checkpoint"}
    row.updated_at = datetime.now(timezone.utc)
    db_session.commit()

    second = load_scheduler_stream_context(db_session, stream_id)
    assert metrics_safe_hit() >= 1
    assert second.checkpoint is not None
    assert second.checkpoint["value"] == {"last_event_id": "s6-fresh-checkpoint"}
    assert second.checkpoint != first_cp


def metrics_safe_hit() -> int:
    return int(context_cache_metrics().get("hits", 0))


def test_scheduler_context_cache_invalidates_on_mapping_update(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = seeded["stream_id"]

    load_scheduler_stream_context(db_session, stream_id)
    load_scheduler_stream_context(db_session, stream_id)
    before = context_cache_metrics()

    mapping = db_session.query(Mapping).filter(Mapping.stream_id == stream_id).one()
    mapping.field_mappings_json = {**mapping.field_mappings_json, "vendor": "$.vendor"}
    mapping.updated_at = datetime.now(timezone.utc)
    db_session.commit()

    load_scheduler_stream_context(db_session, stream_id)
    after = context_cache_metrics()
    assert after["misses"] == before["misses"] + 1
    assert after["version_invalidations"] >= before["version_invalidations"] + 1


def test_explicit_invalidate_stream_context_cache(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = seeded["stream_id"]

    load_scheduler_stream_context(db_session, stream_id)
    invalidate_stream_context_cache(stream_id, reason="test")
    metrics = context_cache_metrics()
    assert metrics["invalidations"] == 1

    load_scheduler_stream_context(db_session, stream_id)
    assert context_cache_metrics()["misses"] == 2


def test_run_complete_includes_timing_trace(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    context = load_stream_context(db_session, seeded["stream_id"])
    poller = _FakePoller(
        response={"items": [{"id": "s6-evt-1", "message": "timing", "vendor": "MappedVendor"}]}
    )
    runner = _build_runner(poller=poller, webhook_sender=_FakeWebhookSender())
    runner.run(context, db=db_session)

    rc = (
        db_session.query(DeliveryLog)
        .filter(DeliveryLog.stream_id == seeded["stream_id"], DeliveryLog.stage == "run_complete")
        .order_by(DeliveryLog.id.desc())
        .first()
    )
    assert rc is not None
    assert rc.latency_ms is not None
    assert rc.latency_ms >= 0

    ps = rc.payload_sample
    assert isinstance(ps, dict)
    assert isinstance(ps.get("run_duration_ms"), int)
    assert ps["run_duration_ms"] >= 0
    trace = ps.get("timing_trace_ms")
    assert isinstance(trace, dict)
    for key in (
        "source_fetch",
        "parse",
        "mapping",
        "enrichment",
        "schema_drift",
        "sensitive_detection",
        "classification",
        "protection",
        "policy",
        "routing",
        "destination_send",
        "run_total",
    ):
        assert key in trace
        assert isinstance(trace[key], int)
        assert trace[key] >= 0
    assert trace["run_total"] == ps["run_duration_ms"]


def test_run_timing_trace_accuracy_with_synthetic_fetch_delay(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed_stream_runtime(db_session)
    context = load_stream_context(db_session, seeded["stream_id"])

    class _SlowPoller(_FakePoller):
        def fetch(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
            time.sleep(0.05)
            return super().fetch(*args, **kwargs)

    runner = _build_runner(poller=_SlowPoller(), webhook_sender=_FakeWebhookSender())
    runner.run(context, db=db_session)

    rc = (
        db_session.query(DeliveryLog)
        .filter(DeliveryLog.stream_id == seeded["stream_id"], DeliveryLog.stage == "run_complete")
        .order_by(DeliveryLog.id.desc())
        .first()
    )
    assert rc is not None
    trace = rc.payload_sample.get("timing_trace_ms") or {}
    assert int(trace.get("source_fetch", 0)) >= 40
