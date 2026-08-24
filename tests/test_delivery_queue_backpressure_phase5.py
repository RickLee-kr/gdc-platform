"""Durable Delivery Queue Phase 5 — Backpressure / Queue Operational Protection.

Covers required scenarios A–P. Does not run Full Matrix. Uses shared queue
lifecycle (no parallel engine). SourceRateLimiter remains separate.
"""

from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from sqlalchemy.orm import Session, sessionmaker

from app.delivery_queue.backpressure import (
    evaluate_backpressure,
    resolve_backpressure_config,
)
from app.delivery_queue.models import (
    DELIVERY_KIND_BASE_ROUTE,
    QUEUE_STATUS_DELIVERED,
    QUEUE_STATUS_EXHAUSTED,
    QUEUE_STATUS_PENDING,
    QUEUE_STATUS_RETRY_WAIT,
    StreamDeliveryQueueItem,
)
from app.delivery_queue.repository import (
    enqueue,
    get_queue_operational_state,
    mark_exhausted,
    try_reserve_queue_slot,
)
from app.rate_limit.source_limiter import SourceRateLimiter
from app.runners.stream_loader import load_stream_context
from app.runners.stream_runner import StreamRunner
from app.runtime.errors import DestinationSendError
from app.streams.models import Stream
from tests.test_delivery_queue_syslog_tcp_phase4 import (
    _StatusSyslogSender,
    _seed_syslog_tcp_queue_stream,
)
from tests.test_delivery_queue_webhook_phase2 import (
    _StatusWebhookSender,
    _queue_rows,
    _seed_queue_stream,
    _stages,
)
from tests.test_stream_runner_e2e import (
    _AllowAllLimiter,
    _FakePoller,
    _FakeWebhookSender,
    _build_runner,
    _checkpoint_value,
    _seed_stream_runtime,
)

pytestmark = [pytest.mark.e2e_checkpoint, pytest.mark.e2e_delivery]


def _set_backpressure_config(
    db: Session,
    stream_id: int,
    *,
    max_pending_items: int,
    resume_pending_items: int | None = None,
    max_pending_age_seconds: float | None = None,
) -> None:
    stream = db.query(Stream).filter(Stream.id == int(stream_id)).one()
    cfg = dict(stream.config_json or {})
    cfg["reliability_mode"] = "PERSISTENT_QUEUE"
    cfg["max_pending_items"] = int(max_pending_items)
    if resume_pending_items is not None:
        cfg["backpressure_resume_items"] = int(resume_pending_items)
    if max_pending_age_seconds is not None:
        cfg["max_pending_age_seconds"] = float(max_pending_age_seconds)
    stream.config_json = cfg
    db.commit()


def _seed_pending_items(
    db: Session,
    seeded: dict[str, Any],
    *,
    count: int,
    status: str = QUEUE_STATUS_PENDING,
) -> list[StreamDeliveryQueueItem]:
    rows: list[StreamDeliveryQueueItem] = []
    for i in range(count):
        row = enqueue(
            db,
            stream_id=int(seeded["stream_id"]),
            route_id=int(seeded["route_ids"][0]),
            destination_id=int(seeded["destination_ids"][0]),
            batch_id=str(uuid.uuid4()),
            delivery_kind=DELIVERY_KIND_BASE_ROUTE,
            payload=[{"event_id": f"bp-{i}", "message": "bp", "vendor": "v", "id": f"bp-{i}"}],
        )
        if status != QUEUE_STATUS_PENDING:
            row.status = status
        rows.append(row)
    db.commit()
    return rows


# --- Unit: config + decision ---


def test_resolve_backpressure_config_defaults() -> None:
    cfg = resolve_backpressure_config({"config_json": {"reliability_mode": "PERSISTENT_QUEUE"}})
    assert cfg.max_pending_items == 100
    assert cfg.resume_pending_items == 50
    assert cfg.max_pending_age_seconds is None


def test_evaluate_hysteresis_high_low_water() -> None:
    from app.delivery_queue.backpressure import QueueBackpressureConfig, QueueOperationalState

    config = QueueBackpressureConfig(max_pending_items=10, resume_pending_items=4)
    high = QueueOperationalState(
        stream_id=1,
        pending_depth=10,
        retry_wait_depth=0,
        inflight_depth=0,
        exhausted_depth=0,
        oldest_pending_age_seconds=1.0,
    )
    mid = QueueOperationalState(
        stream_id=1,
        pending_depth=6,
        retry_wait_depth=0,
        inflight_depth=0,
        exhausted_depth=0,
        oldest_pending_age_seconds=1.0,
    )
    low = QueueOperationalState(
        stream_id=1,
        pending_depth=3,
        retry_wait_depth=0,
        inflight_depth=0,
        exhausted_depth=0,
        oldest_pending_age_seconds=1.0,
    )
    entered = evaluate_backpressure(high, config, previously_active=False)
    assert entered.active and entered.entered and not entered.released
    band = evaluate_backpressure(mid, config, previously_active=True)
    assert band.active and not band.entered and not band.released
    released = evaluate_backpressure(low, config, previously_active=True)
    assert not released.active and released.released


def test_exhausted_excluded_from_pressure(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    _set_backpressure_config(db_session, seeded["stream_id"], max_pending_items=2, resume_pending_items=1)
    rows = _seed_pending_items(db_session, seeded, count=2)
    from app.delivery_queue.repository import claim_next, mark_exhausted as _mark_ex

    for row in rows:
        claimed = claim_next(db_session, lease_owner="ex", stream_id=seeded["stream_id"])
        assert claimed is not None
        _mark_ex(db_session, int(claimed.id), last_error="done")
    db_session.commit()

    state = get_queue_operational_state(db_session, stream_id=seeded["stream_id"])
    assert state.exhausted_depth == 2
    assert state.pressure_depth == 0
    assert state.pending_depth == 0


# --- A. below threshold normal ---


def test_a_below_threshold_normal_enqueue_delivery(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    _set_backpressure_config(db_session, seeded["stream_id"], max_pending_items=10, resume_pending_items=5)
    before = _checkpoint_value(db_session, seeded["stream_id"])
    poller = _FakePoller(response={"items": [{"id": "a-1", "message": "ok", "vendor": "v"}]})
    sender = _FakeWebhookSender()
    runner = _build_runner(poller=poller, webhook_sender=sender)
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is True
    assert _checkpoint_value(db_session, seeded["stream_id"]) != before
    assert _queue_rows(db_session, seeded["stream_id"])[0].status == QUEUE_STATUS_DELIVERED
    stages = _stages(db_session, seeded["stream_id"], str(summary["run_id"]))
    assert "queue_backpressure_entered" not in stages
    assert "queue_enqueued" in stages


# --- B. threshold reached → suppress ---


def test_b_threshold_reached_suppresses_fetch_checkpoint_held(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    _set_backpressure_config(db_session, seeded["stream_id"], max_pending_items=3, resume_pending_items=1)
    _seed_pending_items(db_session, seeded, count=3, status=QUEUE_STATUS_RETRY_WAIT)
    for row in _queue_rows(db_session, seeded["stream_id"]):
        row.available_at = datetime.now(timezone.utc) + timedelta(hours=1)
    db_session.commit()
    before = _checkpoint_value(db_session, seeded["stream_id"])

    poller = _FakePoller(response={"items": [{"id": "should-not", "message": "x", "vendor": "v"}]})
    runner = _build_runner(poller=poller, webhook_sender=_FakeWebhookSender())
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)

    assert poller.calls == []
    assert _checkpoint_value(db_session, seeded["stream_id"]) == before
    assert summary.get("checkpoint_updated") is not True
    stages = _stages(db_session, seeded["stream_id"], str(summary["run_id"]))
    assert "queue_backpressure_entered" in stages or "queue_backpressure_active" in stages
    assert int(summary.get("pressure_depth") or 0) >= 3


# --- C. drain below resume → auto resume ---


def test_c_auto_resume_after_drain_below_low_water(db_session: Session) -> None:
    seeded = _seed_queue_stream(
        db_session,
        dest_configs=[{"retry_count": 5, "retry_backoff_seconds": 0}],
    )
    _set_backpressure_config(db_session, seeded["stream_id"], max_pending_items=3, resume_pending_items=1)
    _seed_pending_items(db_session, seeded, count=3, status=QUEUE_STATUS_RETRY_WAIT)
    for row in _queue_rows(db_session, seeded["stream_id"]):
        row.available_at = datetime.now(timezone.utc) + timedelta(hours=1)
    db_session.commit()

    # Enter backpressure while items are not yet claimable.
    runner = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "blocked", "message": "x", "vendor": "v"}]}),
        webhook_sender=_FakeWebhookSender(),
    )
    s1 = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert "queue_backpressure_entered" in _stages(db_session, seeded["stream_id"], str(s1["run_id"]))
    stream = db_session.query(Stream).filter(Stream.id == seeded["stream_id"]).one()
    assert stream.status == "QUEUE_BACKPRESSURE"

    # Make items claimable and drain with a healthy sender → release + fetch.
    for row in _queue_rows(db_session, seeded["stream_id"]):
        row.available_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        row.status = QUEUE_STATUS_PENDING
    db_session.commit()

    ok_sender = _FakeWebhookSender()
    poller = _FakePoller(response={"items": [{"id": "resume-1", "message": "ok", "vendor": "v"}]})
    runner2 = _build_runner(poller=poller, webhook_sender=ok_sender)
    s2 = runner2.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    stages2 = _stages(db_session, seeded["stream_id"], str(s2["run_id"]))
    assert "queue_backpressure_released" in stages2
    assert len(poller.calls) >= 1
    assert any(r.status == QUEUE_STATUS_DELIVERED for r in _queue_rows(db_session, seeded["stream_id"]))


# --- D. prolonged outage bounds growth ---


def test_d_prolonged_outage_queue_growth_bounded_no_drop(db_session: Session) -> None:
    seeded = _seed_queue_stream(
        db_session,
        failure_policies=["PAUSE_STREAM_ON_FAILURE"],
        dest_configs=[{"retry_count": 2, "retry_backoff_seconds": 0.01}],
    )
    _set_backpressure_config(db_session, seeded["stream_id"], max_pending_items=2, resume_pending_items=0)
    before = _checkpoint_value(db_session, seeded["stream_id"])
    err = DestinationSendError("outage", http_status=503)
    sender = _StatusWebhookSender(responses=[err] * 20)
    poller = _FakePoller(response={"items": [{"id": "d-1", "message": "x", "vendor": "v"}]})
    runner = _build_runner(poller=poller, webhook_sender=sender)

    for _ in range(5):
        runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)

    rows = _queue_rows(db_session, seeded["stream_id"])
    non_terminal = [r for r in rows if r.status not in {QUEUE_STATUS_DELIVERED, QUEUE_STATUS_EXHAUSTED}]
    # Bounded by policy (+ at most one in-flight race); never unbounded growth.
    assert len(non_terminal) <= 2
    assert _checkpoint_value(db_session, seeded["stream_id"]) == before
    # No discard path: items still present (RETRY_WAIT/PENDING/IN_FLIGHT).
    assert len(non_terminal) >= 1


def test_e_webhook_queue_backpressure(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    _set_backpressure_config(db_session, seeded["stream_id"], max_pending_items=2, resume_pending_items=0)
    _seed_pending_items(db_session, seeded, count=2, status=QUEUE_STATUS_RETRY_WAIT)
    for row in _queue_rows(db_session, seeded["stream_id"]):
        row.available_at = datetime.now(timezone.utc) + timedelta(hours=1)
    db_session.commit()
    poller = _FakePoller(response={"items": [{"id": "e", "message": "x", "vendor": "v"}]})
    runner = _build_runner(poller=poller, webhook_sender=_FakeWebhookSender())
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert poller.calls == []
    assert summary.get("queue_backpressure_active") is True


def test_f_syslog_tcp_queue_backpressure(db_session: Session) -> None:
    from tests.test_delivery_queue_syslog_tcp_phase4 import _build_syslog_runner

    seeded = _seed_syslog_tcp_queue_stream(db_session)
    _set_backpressure_config(db_session, seeded["stream_id"], max_pending_items=2, resume_pending_items=0)
    _seed_pending_items(db_session, seeded, count=2, status=QUEUE_STATUS_RETRY_WAIT)
    for row in _queue_rows(db_session, seeded["stream_id"]):
        row.available_at = datetime.now(timezone.utc) + timedelta(hours=1)
    db_session.commit()
    poller = _FakePoller(response={"items": [{"id": "f", "message": "x", "vendor": "v"}]})
    runner = _build_syslog_runner(poller=poller, syslog_sender=_StatusSyslogSender(responses=[]))
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert poller.calls == []
    assert summary.get("queue_backpressure_active") is True


# --- G. RETRY_WAIT contributes ---


def test_g_retry_wait_contributes_to_pressure(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    _set_backpressure_config(db_session, seeded["stream_id"], max_pending_items=2, resume_pending_items=0)
    _seed_pending_items(db_session, seeded, count=2, status=QUEUE_STATUS_RETRY_WAIT)
    # Make RETRY_WAIT not claimable yet.
    for row in _queue_rows(db_session, seeded["stream_id"]):
        row.available_at = datetime.now(timezone.utc) + timedelta(hours=1)
    db_session.commit()

    state = get_queue_operational_state(db_session, stream_id=seeded["stream_id"])
    assert state.retry_wait_depth == 2
    assert state.pressure_depth == 2

    poller = _FakePoller(response={"items": [{"id": "g", "message": "x", "vendor": "v"}]})
    runner = _build_runner(poller=poller, webhook_sender=_FakeWebhookSender())
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert poller.calls == []
    assert summary.get("retry_wait_depth") == 2
    assert summary.get("queue_backpressure_active") is True


# --- H. EXHAUSTED does not permanently block ---


def test_h_exhausted_does_not_permanently_block(db_session: Session) -> None:
    from app.delivery_queue.repository import claim_next

    seeded = _seed_queue_stream(db_session)
    _set_backpressure_config(db_session, seeded["stream_id"], max_pending_items=2, resume_pending_items=0)
    _seed_pending_items(db_session, seeded, count=2)
    for _ in range(2):
        claimed = claim_next(db_session, lease_owner="ex", stream_id=seeded["stream_id"])
        assert claimed is not None
        mark_exhausted(db_session, int(claimed.id), last_error="terminal")
    db_session.commit()

    poller = _FakePoller(response={"items": [{"id": "h-1", "message": "ok", "vendor": "v"}]})
    sender = _FakeWebhookSender()
    runner = _build_runner(poller=poller, webhook_sender=sender)
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert len(poller.calls) >= 1
    assert summary.get("checkpoint_updated") is True
    assert "queue_backpressure_entered" not in _stages(
        db_session, seeded["stream_id"], str(summary["run_id"])
    )


# --- I. concurrent workers ---


def test_i_concurrent_enqueue_respects_max_pending(db_session: Session, db_engine) -> None:
    seeded = _seed_queue_stream(db_session)
    _set_backpressure_config(db_session, seeded["stream_id"], max_pending_items=2, resume_pending_items=0)
    db_session.commit()
    SessionLocal = sessionmaker(bind=db_engine, expire_on_commit=False)
    barrier = threading.Barrier(4)
    results: list[bool] = []
    lock = threading.Lock()

    def _worker() -> None:
        session = SessionLocal()
        try:
            barrier.wait(timeout=5)
            ok = try_reserve_queue_slot(
                session, stream_id=int(seeded["stream_id"]), max_pending_items=2
            )
            if ok:
                enqueue(
                    session,
                    stream_id=int(seeded["stream_id"]),
                    route_id=int(seeded["route_ids"][0]),
                    destination_id=int(seeded["destination_ids"][0]),
                    batch_id=str(uuid.uuid4()),
                    delivery_kind=DELIVERY_KIND_BASE_ROUTE,
                    payload=[{"event_id": "c", "message": "x", "vendor": "v"}],
                )
            session.commit()
            with lock:
                results.append(ok)
        finally:
            session.close()

    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = [pool.submit(_worker) for _ in range(4)]
        for fut in as_completed(futs):
            fut.result()

    assert results.count(True) == 2
    assert results.count(False) == 2
    assert len(_queue_rows(db_session, seeded["stream_id"])) == 2


# --- J. restart while backpressure active ---


def test_j_restart_reconstructs_backpressure_from_db(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    _set_backpressure_config(db_session, seeded["stream_id"], max_pending_items=2, resume_pending_items=0)
    _seed_pending_items(db_session, seeded, count=2, status=QUEUE_STATUS_RETRY_WAIT)
    for row in _queue_rows(db_session, seeded["stream_id"]):
        row.available_at = datetime.now(timezone.utc) + timedelta(hours=1)
    stream = db_session.query(Stream).filter(Stream.id == seeded["stream_id"]).one()
    stream.status = "QUEUE_BACKPRESSURE"
    db_session.commit()

    # New runner instance = process restart.
    poller = _FakePoller(response={"items": [{"id": "j", "message": "x", "vendor": "v"}]})
    runner = _build_runner(poller=poller, webhook_sender=_FakeWebhookSender())
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert poller.calls == []
    assert summary.get("queue_backpressure_active") is True
    stages = _stages(db_session, seeded["stream_id"], str(summary["run_id"]))
    assert "queue_backpressure_active" in stages


# --- K. observability ---


def test_k_observability_evidence_and_depth_fields(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    _set_backpressure_config(db_session, seeded["stream_id"], max_pending_items=2, resume_pending_items=0)
    _seed_pending_items(db_session, seeded, count=2, status=QUEUE_STATUS_RETRY_WAIT)
    for row in _queue_rows(db_session, seeded["stream_id"]):
        row.available_at = datetime.now(timezone.utc) + timedelta(hours=1)
        row.created_at = datetime.now(timezone.utc) - timedelta(seconds=30)
    db_session.commit()

    runner = _build_runner(
        poller=_FakePoller(response={"items": []}),
        webhook_sender=_FakeWebhookSender(),
    )
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("pending_depth") == 0
    assert summary.get("retry_depth") == 2 or summary.get("retry_wait_depth") == 2
    assert summary.get("oldest_pending_age_seconds") is not None
    assert float(summary["oldest_pending_age_seconds"]) >= 20.0
    stages = _stages(db_session, seeded["stream_id"], str(summary["run_id"]))
    assert {"queue_backpressure_entered", "queue_backpressure_active"} & stages


# --- L. Source Rate Limiter regression ---


def test_l_source_rate_limiter_still_independent(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    _set_backpressure_config(db_session, seeded["stream_id"], max_pending_items=100, resume_pending_items=50)
    stream = db_session.query(Stream).filter(Stream.id == seeded["stream_id"]).one()
    stream.rate_limit_json = {"max_requests": 1, "per_seconds": 3600}
    db_session.commit()

    poller = _FakePoller(response={"items": [{"id": "l1", "message": "ok", "vendor": "v"}]})
    sender = _FakeWebhookSender()
    limiter = SourceRateLimiter()
    runner = StreamRunner(
        poller=poller,
        webhook_sender=sender,
        source_limiter=limiter,
        destination_limiter=_AllowAllLimiter(),
    )
    s1 = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert s1.get("checkpoint_updated") is True
    s2 = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    stages2 = _stages(db_session, seeded["stream_id"], str(s2["run_id"]))
    assert "source_rate_limited" in stages2
    assert "queue_backpressure_entered" not in stages2


# --- M/N/O/P regressions ---


def test_m_http_resilience_retry_wait_still_works(db_session: Session) -> None:
    seeded = _seed_queue_stream(
        db_session,
        failure_policies=["PAUSE_STREAM_ON_FAILURE"],
        dest_configs=[{"retry_count": 2, "retry_backoff_seconds": 0.01}],
    )
    _set_backpressure_config(db_session, seeded["stream_id"], max_pending_items=50, resume_pending_items=25)
    before = _checkpoint_value(db_session, seeded["stream_id"])
    err = DestinationSendError("timeout", http_status=None)
    err.__cause__ = TimeoutError("boom")
    sender = _StatusWebhookSender(responses=[err])
    runner = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "m-1", "message": "x", "vendor": "v"}]}),
        webhook_sender=sender,
    )
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert _checkpoint_value(db_session, seeded["stream_id"]) == before
    rows = _queue_rows(db_session, seeded["stream_id"])
    assert len(rows) == 1
    assert rows[0].status == QUEUE_STATUS_RETRY_WAIT
    assert "queue_retry_wait" in _stages(db_session, seeded["stream_id"], str(summary["run_id"]))


def test_n_restart_recovery_still_delivers(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    _set_backpressure_config(db_session, seeded["stream_id"], max_pending_items=50, resume_pending_items=25)
    _seed_pending_items(db_session, seeded, count=1)
    before = _checkpoint_value(db_session, seeded["stream_id"])
    sender = _FakeWebhookSender()
    runner = _build_runner(poller=_FakePoller(response={"items": []}), webhook_sender=sender)
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert _queue_rows(db_session, seeded["stream_id"])[0].status == QUEUE_STATUS_DELIVERED
    assert summary.get("checkpoint_updated") is True
    assert _checkpoint_value(db_session, seeded["stream_id"]) != before


def test_o_direct_mode_unchanged(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    # Explicit DIRECT — no backpressure stages.
    stream = db_session.query(Stream).filter(Stream.id == seeded["stream_id"]).one()
    cfg = dict(stream.config_json or {})
    cfg["reliability_mode"] = "DIRECT"
    cfg["max_pending_items"] = 1
    stream.config_json = cfg
    db_session.commit()

    poller = _FakePoller(response={"items": [{"id": "o-1", "message": "ok", "vendor": "v"}]})
    sender = _FakeWebhookSender()
    runner = _build_runner(poller=poller, webhook_sender=sender)
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is True
    assert _queue_rows(db_session, seeded["stream_id"]) == []
    stages = _stages(db_session, seeded["stream_id"], str(summary["run_id"]))
    assert "queue_enqueued" not in stages
    assert "queue_backpressure_entered" not in stages


def test_p_checkpoint_hold_and_advance(db_session: Session) -> None:
    seeded = _seed_queue_stream(
        db_session,
        dest_configs=[{"retry_count": 2, "retry_backoff_seconds": 0}],
    )
    _set_backpressure_config(db_session, seeded["stream_id"], max_pending_items=50, resume_pending_items=25)
    before = _checkpoint_value(db_session, seeded["stream_id"])
    err = DestinationSendError("fail", http_status=503)
    fail_sender = _StatusWebhookSender(responses=[err])
    runner = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "p-1", "message": "x", "vendor": "v"}]}),
        webhook_sender=fail_sender,
    )
    runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert _checkpoint_value(db_session, seeded["stream_id"]) == before

    for row in _queue_rows(db_session, seeded["stream_id"]):
        if row.status == QUEUE_STATUS_RETRY_WAIT:
            row.available_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()

    ok_sender = _FakeWebhookSender()
    runner2 = _build_runner(poller=_FakePoller(response={"items": []}), webhook_sender=ok_sender)
    s2 = runner2.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert s2.get("checkpoint_updated") is True
    assert _checkpoint_value(db_session, seeded["stream_id"]) != before


def test_destination_scoped_operational_state(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    _seed_pending_items(db_session, seeded, count=2)
    dest_id = int(seeded["destination_ids"][0])
    state = get_queue_operational_state(
        db_session, stream_id=seeded["stream_id"], destination_id=dest_id
    )
    assert state.pending_depth == 2
    assert state.destination_id == dest_id
    other = get_queue_operational_state(
        db_session, stream_id=seeded["stream_id"], destination_id=dest_id + 99999
    )
    assert other.pending_depth == 0
