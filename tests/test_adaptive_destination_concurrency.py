"""Adaptive Destination Concurrency — targeted tests (A–Q).

AIMD per destination_id. Separate from Rate Limiter, HTTP Resilience,
Circuit Breaker, and Queue Backpressure. Default: disabled (baseline unchanged).
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
import pytest
from sqlalchemy.orm import Session

from app.delivery.adaptive_concurrency import (
    AdaptiveConcurrencyConfig,
    ConcurrencySignal,
    DestinationAdaptiveConcurrency,
    classify_concurrency_signal,
    resolve_adaptive_concurrency_config,
)
from app.delivery.circuit_breaker import CircuitState
from app.delivery.process_adaptive_concurrency import (
    get_process_destination_adaptive_concurrency,
    reset_process_destination_adaptive_concurrency_for_tests,
)
from app.delivery.process_circuit_breaker import (
    get_process_destination_circuit_breaker,
    reset_process_destination_circuit_breaker_for_tests,
)
from app.delivery_queue.models import (
    QUEUE_STATUS_DELIVERED,
    QUEUE_STATUS_IN_FLIGHT,
    QUEUE_STATUS_PENDING,
    QUEUE_STATUS_RETRY_WAIT,
)
from app.destinations.models import Destination
from app.runtime.errors import DestinationSendError
from app.runners.stream_loader import load_stream_context
from app.streams.models import Stream
from tests.test_delivery_queue_backpressure_phase5 import _set_backpressure_config
from tests.test_delivery_queue_syslog_tcp_phase4 import (
    _StatusSyslogSender,
    _build_syslog_runner,
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


@pytest.fixture(autouse=True)
def _reset_adaptive_and_circuit() -> None:
    reset_process_destination_adaptive_concurrency_for_tests()
    reset_process_destination_circuit_breaker_for_tests()
    yield
    reset_process_destination_adaptive_concurrency_for_tests()
    reset_process_destination_circuit_breaker_for_tests()


def _set_adaptive(
    db: Session,
    destination_id: int,
    *,
    enabled: bool = True,
    min_concurrency: int = 1,
    max_concurrency: int = 4,
) -> None:
    dest = db.query(Destination).filter(Destination.id == int(destination_id)).one()
    cfg = dict(dest.config_json or {})
    cfg["adaptive_concurrency"] = {
        "enabled": bool(enabled),
        "min_concurrency": int(min_concurrency),
        "max_concurrency": int(max_concurrency),
    }
    cfg.setdefault("retry_count", 0)
    cfg.setdefault("retry_backoff_seconds", 0.01)
    dest.config_json = cfg
    db.commit()


def _err_5xx() -> DestinationSendError:
    return DestinationSendError("upstream 503", http_status=503)


def _err_429() -> DestinationSendError:
    return DestinationSendError("rl", http_status=429, retry_after_seconds=2.0)


def _err_timeout() -> DestinationSendError:
    err = DestinationSendError("timed out", http_status=None)
    err.__cause__ = httpx.ReadTimeout("read timed out")
    return err


def test_unit_aimd_and_classify() -> None:
    assert resolve_adaptive_concurrency_config({}).enabled is False
    cfg = resolve_adaptive_concurrency_config(
        {"adaptive_concurrency": {"enabled": True, "min_concurrency": 1, "max_concurrency": 3}}
    )
    assert cfg.enabled is True
    assert cfg.max_concurrency == 3

    assert classify_concurrency_signal(success=True, latency_ms=10, ewma_latency_ms=10.0) == (
        ConcurrencySignal.SUCCESS
    )
    assert classify_concurrency_signal(success=True, latency_ms=50, ewma_latency_ms=10.0) == (
        ConcurrencySignal.LATENCY_SPIKE
    )
    assert classify_concurrency_signal(success=False, error=_err_429()) == (
        ConcurrencySignal.RATE_LIMIT_429
    )
    assert classify_concurrency_signal(success=False, error=_err_timeout()) == (
        ConcurrencySignal.TIMEOUT
    )
    assert classify_concurrency_signal(success=False, error=_err_5xx()) == (
        ConcurrencySignal.TRANSIENT_FAILURE
    )

    ctl = DestinationAdaptiveConcurrency()
    acfg = AdaptiveConcurrencyConfig(enabled=True, min_concurrency=1, max_concurrency=4)
    for _ in range(3):
        ctl.record_signal(1, acfg, signal=ConcurrencySignal.SUCCESS, latency_ms=5)
    assert ctl.get_limit(1, acfg) == 2
    ctl.record_signal(1, acfg, signal=ConcurrencySignal.RATE_LIMIT_429)
    assert ctl.get_limit(1, acfg) == 1


def test_a_adaptive_disabled_unchanged(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    dest_id = int(seeded["destination_ids"][0])
    _set_adaptive(db_session, dest_id, enabled=False, max_concurrency=4)
    sender = _FakeWebhookSender()
    summary = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "a1", "message": "ok", "vendor": "v"}]}),
        webhook_sender=sender,
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is True
    assert len(sender.calls) == 1
    assert get_process_destination_adaptive_concurrency().get_active(dest_id) == 0
    stages = _stages(db_session, seeded["stream_id"])
    assert "concurrency_increased" not in stages
    assert "concurrency_limited" not in stages


def test_b_healthy_increase(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    dest_id = int(seeded["destination_ids"][0])
    _set_adaptive(db_session, dest_id, enabled=True, min_concurrency=1, max_concurrency=3)
    sender = _FakeWebhookSender()
    for i in range(3):
        _build_runner(
            poller=_FakePoller(
                response={"items": [{"id": f"b-{i}", "message": "ok", "vendor": "v"}]}
            ),
            webhook_sender=sender,
        ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    ctl = get_process_destination_adaptive_concurrency()
    assert ctl.get_limit(dest_id, AdaptiveConcurrencyConfig(enabled=True, min_concurrency=1, max_concurrency=3)) >= 2
    assert "concurrency_increased" in _stages(db_session, seeded["stream_id"])


def test_c_latency_decrease() -> None:
    ctl = DestinationAdaptiveConcurrency()
    cfg = AdaptiveConcurrencyConfig(enabled=True, min_concurrency=1, max_concurrency=4)
    ctl.force_limit_for_tests(5, 4)
    ctl.record_signal(5, cfg, signal=ConcurrencySignal.SUCCESS, latency_ms=10)
    adj = ctl.record_signal(5, cfg, signal=ConcurrencySignal.LATENCY_SPIKE, latency_ms=100)
    assert adj is not None and adj.event == "concurrency_decreased"
    assert ctl.get_limit(5, cfg) == 2


def test_d_timeout_5xx_decrease() -> None:
    ctl = DestinationAdaptiveConcurrency()
    cfg = AdaptiveConcurrencyConfig(enabled=True, min_concurrency=1, max_concurrency=4)
    ctl.force_limit_for_tests(6, 4)
    ctl.record_signal(6, cfg, signal=ConcurrencySignal.TIMEOUT)
    assert ctl.get_limit(6, cfg) == 2
    ctl.record_signal(6, cfg, signal=ConcurrencySignal.TRANSIENT_FAILURE)
    assert ctl.get_limit(6, cfg) == 1


def test_e_429_decrease_and_retry_after(db_session: Session) -> None:
    seeded = _seed_queue_stream(
        db_session,
        dest_configs=[{"retry_count": 2, "retry_backoff_seconds": 0.01}],
    )
    dest_id = int(seeded["destination_ids"][0])
    _set_adaptive(db_session, dest_id, enabled=True, min_concurrency=1, max_concurrency=4)
    ctl = get_process_destination_adaptive_concurrency()
    ctl.force_limit_for_tests(dest_id, 4)
    _build_runner(
        poller=_FakePoller(response={"items": [{"id": "e1", "message": "x", "vendor": "v"}]}),
        webhook_sender=_StatusWebhookSender(responses=[_err_429()]),
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert ctl.get_limit(dest_id, AdaptiveConcurrencyConfig(enabled=True, min_concurrency=1, max_concurrency=4)) == 1
    rows = _queue_rows(db_session, seeded["stream_id"])
    assert rows and rows[0].status == QUEUE_STATUS_RETRY_WAIT
    assert "concurrency_decreased" in _stages(db_session, seeded["stream_id"])


def test_f_min_max_boundary() -> None:
    ctl = DestinationAdaptiveConcurrency()
    cfg = AdaptiveConcurrencyConfig(enabled=True, min_concurrency=2, max_concurrency=3)
    ctl.force_limit_for_tests(7, 2)
    for _ in range(10):
        ctl.record_signal(7, cfg, signal=ConcurrencySignal.SUCCESS, latency_ms=1)
    assert ctl.get_limit(7, cfg) == 3
    ctl.record_signal(7, cfg, signal=ConcurrencySignal.RATE_LIMIT_429)
    assert ctl.get_limit(7, cfg) == 2


def test_g_destination_isolation(db_session: Session) -> None:
    seeded_a = _seed_queue_stream(db_session)
    seeded_b = _seed_queue_stream(db_session)
    dest_a = int(seeded_a["destination_ids"][0])
    dest_b = int(seeded_b["destination_ids"][0])
    _set_adaptive(db_session, dest_a, enabled=True, min_concurrency=1, max_concurrency=4)
    _set_adaptive(db_session, dest_b, enabled=True, min_concurrency=1, max_concurrency=4)
    ctl = get_process_destination_adaptive_concurrency()
    ctl.force_limit_for_tests(dest_a, 4)
    ctl.force_limit_for_tests(dest_b, 3)
    _build_runner(
        poller=_FakePoller(response={"items": [{"id": "ga", "message": "x", "vendor": "v"}]}),
        webhook_sender=_StatusWebhookSender(responses=[_err_5xx()]),
    ).run(load_stream_context(db_session, seeded_a["stream_id"]), db=db_session)
    assert ctl.get_limit(dest_a, AdaptiveConcurrencyConfig(enabled=True, min_concurrency=1, max_concurrency=4)) == 2
    assert ctl.get_limit(dest_b, AdaptiveConcurrencyConfig(enabled=True, min_concurrency=1, max_concurrency=4)) == 3


def test_h_active_io_limit() -> None:
    ctl = DestinationAdaptiveConcurrency()
    cfg = AdaptiveConcurrencyConfig(enabled=True, min_concurrency=1, max_concurrency=2)
    ctl.force_limit_for_tests(8, 2)
    granted = []
    limited = []
    lock = threading.Lock()

    def _worker() -> None:
        acq, adj = ctl.try_acquire(8, cfg)
        with lock:
            if acq.granted:
                granted.append(1)
            else:
                limited.append(1)
                assert adj is not None and adj.event == "concurrency_limited"
        if acq.granted:
            time.sleep(0.05)
            ctl.release(8, cfg, signal=ConcurrencySignal.SUCCESS, latency_ms=1)

    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = [pool.submit(_worker) for _ in range(6)]
        for fut in futs:
            fut.result()
    assert len(granted) >= 2
    assert len(limited) >= 1
    assert ctl.get_active(8) == 0


def test_i_circuit_open_no_io(db_session: Session) -> None:
    seeded = _seed_queue_stream(
        db_session,
        dest_configs=[{"retry_count": 0, "retry_backoff_seconds": 0.01}],
    )
    dest_id = int(seeded["destination_ids"][0])
    _set_adaptive(db_session, dest_id, enabled=True, min_concurrency=1, max_concurrency=4)
    dest = db_session.query(Destination).filter(Destination.id == dest_id).one()
    cfg = dict(dest.config_json or {})
    cfg["circuit_breaker"] = {"failure_threshold": 1, "open_seconds": 60}
    dest.config_json = cfg
    db_session.commit()

    sender = _StatusWebhookSender(responses=[_err_5xx(), _err_5xx()])
    _build_runner(
        poller=_FakePoller(response={"items": [{"id": "i1", "message": "x", "vendor": "v"}]}),
        webhook_sender=sender,
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert get_process_destination_circuit_breaker().get_state(dest_id) == CircuitState.OPEN
    calls = len(sender.calls)
    _build_runner(
        poller=_FakePoller(response={"items": [{"id": "i2", "message": "x", "vendor": "v"}]}),
        webhook_sender=sender,
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert len(sender.calls) == calls


def test_j_half_open_single_probe() -> None:
    from app.delivery.circuit_breaker import CircuitDecision, resolve_circuit_breaker_config

    b = get_process_destination_circuit_breaker()
    cfg = resolve_circuit_breaker_config(
        {"circuit_breaker": {"failure_threshold": 1, "open_seconds": 0.01}}
    )
    b.record_failure(99, cfg)
    time.sleep(0.02)
    results = []
    lock = threading.Lock()

    def _probe() -> None:
        decision = b.allow(99, cfg).decision
        with lock:
            results.append(decision)

    with ThreadPoolExecutor(max_workers=8) as pool:
        for fut in [pool.submit(_probe) for _ in range(8)]:
            fut.result()
    assert results.count(CircuitDecision.ALLOW_PROBE) == 1
    assert results.count(CircuitDecision.BLOCK) == 7


def test_k_backpressure_interaction(db_session: Session) -> None:
    seeded = _seed_queue_stream(
        db_session,
        dest_configs=[{"retry_count": 0, "retry_backoff_seconds": 0.01}],
    )
    dest_id = int(seeded["destination_ids"][0])
    _set_adaptive(db_session, dest_id, enabled=True, min_concurrency=1, max_concurrency=2)
    _set_backpressure_config(
        db_session,
        int(seeded["stream_id"]),
        max_pending_items=2,
        resume_pending_items=1,
    )
    get_process_destination_adaptive_concurrency().force_limit_for_tests(dest_id, 1)
    sender = _StatusWebhookSender(responses=[_err_5xx()] * 5)
    for i in range(3):
        _build_runner(
            poller=_FakePoller(response={"items": [{"id": f"k-{i}", "message": "x", "vendor": "v"}]}),
            webhook_sender=sender,
        ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    rows = _queue_rows(db_session, seeded["stream_id"])
    assert len(rows) >= 1
    stages = _stages(db_session, seeded["stream_id"])
    assert "concurrency_decreased" in stages or any(
        r.status in {QUEUE_STATUS_RETRY_WAIT, QUEUE_STATUS_PENDING} for r in rows
    )


def test_l_queue_recovery_regression(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    dest_id = int(seeded["destination_ids"][0])
    _set_adaptive(db_session, dest_id, enabled=True, min_concurrency=1, max_concurrency=2)
    sender = _StatusWebhookSender(responses=[_err_5xx(), None])
    _build_runner(
        poller=_FakePoller(response={"items": [{"id": "l1", "message": "x", "vendor": "v"}]}),
        webhook_sender=sender,
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    summary = _build_runner(
        poller=_FakePoller(response={"items": []}),
        webhook_sender=sender,
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    rows = _queue_rows(db_session, seeded["stream_id"])
    assert rows
    assert all(
        r.status
        in {QUEUE_STATUS_DELIVERED, QUEUE_STATUS_RETRY_WAIT, QUEUE_STATUS_PENDING, QUEUE_STATUS_IN_FLIGHT}
        for r in rows
    )
    assert summary is not None


def test_m_webhook_regression(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    dest_id = int(seeded["destination_ids"][0])
    _set_adaptive(db_session, dest_id, enabled=True, min_concurrency=1, max_concurrency=2)
    sender = _FakeWebhookSender()
    summary = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "m1", "message": "ok", "vendor": "v"}]}),
        webhook_sender=sender,
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is True
    assert len(sender.calls) == 1
    assert _queue_rows(db_session, seeded["stream_id"])[0].status == QUEUE_STATUS_DELIVERED


def test_n_syslog_tcp_regression(db_session: Session) -> None:
    seeded = _seed_syslog_tcp_queue_stream(db_session)
    dest_id = int(seeded["destination_ids"][0])
    _set_adaptive(db_session, dest_id, enabled=True, min_concurrency=1, max_concurrency=2)
    sender = _StatusSyslogSender(responses=[None])
    summary = _build_syslog_runner(
        poller=_FakePoller(response={"items": [{"id": "n1", "message": "ok", "vendor": "v"}]}),
        syslog_sender=sender,
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is True
    assert len(sender.calls) == 1


def test_o_direct_mode_unchanged_when_disabled(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    sender = _FakeWebhookSender()
    summary = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "o1", "message": "ok", "vendor": "v"}]}),
        webhook_sender=sender,
        source_limiter=_AllowAllLimiter(),
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is True
    assert len(sender.calls) == 1
    assert _queue_rows(db_session, seeded["stream_id"]) == []


def test_p_checkpoint_regression(db_session: Session) -> None:
    seeded = _seed_queue_stream(
        db_session,
        dest_configs=[{"retry_count": 0, "retry_backoff_seconds": 0.01}],
    )
    dest_id = int(seeded["destination_ids"][0])
    _set_adaptive(db_session, dest_id, enabled=True, min_concurrency=1, max_concurrency=2)
    before = _checkpoint_value(db_session, seeded["stream_id"])
    summary = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "p1", "message": "x", "vendor": "v"}]}),
        webhook_sender=_StatusWebhookSender(responses=[_err_5xx()]),
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is False
    assert _checkpoint_value(db_session, seeded["stream_id"]) == before


def test_q_observability_events(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    dest_id = int(seeded["destination_ids"][0])
    _set_adaptive(db_session, dest_id, enabled=True, min_concurrency=1, max_concurrency=3)
    sender = _FakeWebhookSender()
    for i in range(3):
        _build_runner(
            poller=_FakePoller(
                response={"items": [{"id": f"q-{i}", "message": "ok", "vendor": "v"}]}
            ),
            webhook_sender=sender,
        ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    stages = _stages(db_session, seeded["stream_id"])
    assert "concurrency_increased" in stages

    ctl = get_process_destination_adaptive_concurrency()
    ctl.force_limit_for_tests(dest_id, 1, active=1)
    _build_runner(
        poller=_FakePoller(response={"items": [{"id": "q-lim", "message": "x", "vendor": "v"}]}),
        webhook_sender=sender,
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    stages2 = _stages(db_session, seeded["stream_id"])
    assert "concurrency_limited" in stages2


def test_circuit_open_blocks_increase() -> None:
    ctl = DestinationAdaptiveConcurrency()
    cfg = AdaptiveConcurrencyConfig(enabled=True, min_concurrency=1, max_concurrency=4)
    for _ in range(5):
        ctl.record_signal(
            11, cfg, signal=ConcurrencySignal.SUCCESS, latency_ms=1, circuit_open=True
        )
    assert ctl.get_limit(11, cfg) == 1
