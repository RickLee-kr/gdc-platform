"""Destination Circuit Breaker — targeted integration tests (A–R).

Covers CLOSED → OPEN → HALF_OPEN → CLOSED without inventing a parallel health
engine. HTTP Resilience remains the per-request retry layer; Durable Queue +
Backpressure remain responsible for persistence and source suppression.
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
import pytest
from sqlalchemy.orm import Session

from app.delivery.circuit_breaker import (
    CircuitDecision,
    CircuitOpenError,
    CircuitState,
    DestinationCircuitBreaker,
    is_circuit_failure_error,
    resolve_circuit_breaker_config,
)
from app.delivery.process_circuit_breaker import (
    get_process_destination_circuit_breaker,
    reset_process_destination_circuit_breaker_for_tests,
)
from app.delivery_queue.models import (
    QUEUE_STATUS_DELIVERED,
    QUEUE_STATUS_PENDING,
    QUEUE_STATUS_RETRY_WAIT,
)
from app.destinations.models import Destination
from app.failover_routing.operator_workflow import create_failover_route
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
def _reset_circuit() -> None:
    reset_process_destination_circuit_breaker_for_tests()
    yield
    reset_process_destination_circuit_breaker_for_tests()


def _set_dest_circuit(
    db: Session,
    destination_id: int,
    *,
    failure_threshold: int = 3,
    open_seconds: float = 0.25,
) -> None:
    dest = db.query(Destination).filter(Destination.id == int(destination_id)).one()
    cfg = dict(dest.config_json or {})
    cfg["circuit_breaker"] = {
        "failure_threshold": int(failure_threshold),
        "open_seconds": float(open_seconds),
    }
    cfg.setdefault("retry_count", 0)
    cfg.setdefault("retry_backoff_seconds", 0.01)
    dest.config_json = cfg
    db.commit()


def _err_5xx() -> DestinationSendError:
    return DestinationSendError("upstream 503", http_status=503)


def _err_conn() -> DestinationSendError:
    err = DestinationSendError("connection failed", http_status=None)
    err.__cause__ = httpx.ConnectError("connection refused")
    return err


def test_unit_classification_and_single_probe() -> None:
    assert is_circuit_failure_error(DestinationSendError("rl", http_status=429)) is False
    assert is_circuit_failure_error(DestinationSendError("bad", http_status=400)) is False
    assert is_circuit_failure_error(_err_5xx()) is True
    assert is_circuit_failure_error(_err_conn()) is True

    b = DestinationCircuitBreaker()
    cfg = resolve_circuit_breaker_config(
        {"circuit_breaker": {"failure_threshold": 2, "open_seconds": 0.05}}
    )
    assert b.record_failure(7, cfg) is None
    opened = b.record_failure(7, cfg)
    assert opened is not None and opened.to_state == CircuitState.OPEN
    assert b.allow(7, cfg).decision == CircuitDecision.BLOCK
    time.sleep(0.06)
    first = b.allow(7, cfg)
    second = b.allow(7, cfg)
    assert first.decision == CircuitDecision.ALLOW_PROBE
    assert first.transitioned_to_half_open is True
    assert second.decision == CircuitDecision.BLOCK


def test_a_healthy_closed_normal_delivery(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    dest_id = int(seeded["destination_ids"][0])
    _set_dest_circuit(db_session, dest_id, failure_threshold=3, open_seconds=30)
    sender = _FakeWebhookSender()
    runner = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "cb-a", "message": "ok", "vendor": "v"}]}),
        webhook_sender=sender,
    )
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is True
    assert len(sender.calls) == 1
    assert get_process_destination_circuit_breaker().get_state(dest_id) == CircuitState.CLOSED
    rows = _queue_rows(db_session, seeded["stream_id"])
    assert rows and rows[0].status == QUEUE_STATUS_DELIVERED


def test_b_c_d_threshold_opens_blocks_io_holds_queue(db_session: Session) -> None:
    seeded = _seed_queue_stream(
        db_session,
        dest_configs=[{"retry_count": 0, "retry_backoff_seconds": 0.01}],
    )
    dest_id = int(seeded["destination_ids"][0])
    _set_dest_circuit(db_session, dest_id, failure_threshold=2, open_seconds=60)
    sender = _StatusWebhookSender(responses=[_err_5xx(), _err_5xx(), _err_5xx(), _err_5xx()])
    before = _checkpoint_value(db_session, seeded["stream_id"])

    for i in range(3):
        runner = _build_runner(
            poller=_FakePoller(
                response={"items": [{"id": f"cb-b-{i}", "message": str(i), "vendor": "v"}]}
            ),
            webhook_sender=sender,
        )
        runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)

    assert get_process_destination_circuit_breaker().get_state(dest_id) == CircuitState.OPEN
    calls_at_open = len(sender.calls)
    runner = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "cb-blocked", "message": "x", "vendor": "v"}]}),
        webhook_sender=sender,
    )
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert len(sender.calls) == calls_at_open
    assert summary.get("checkpoint_updated") is False
    assert _checkpoint_value(db_session, seeded["stream_id"]) == before
    rows = _queue_rows(db_session, seeded["stream_id"])
    assert rows
    assert any(r.status == QUEUE_STATUS_RETRY_WAIT for r in rows)
    stages = _stages(db_session, seeded["stream_id"])
    assert "circuit_opened" in stages
    assert "circuit_request_blocked" in stages


def test_e_f_half_open_probe_success_closes(db_session: Session) -> None:
    """Trip OPEN on durable path, then probe-close on DIRECT path (no queue recovery race)."""

    seeded = _seed_queue_stream(
        db_session,
        dest_configs=[{"retry_count": 0, "retry_backoff_seconds": 0.01}],
    )
    dest_id = int(seeded["destination_ids"][0])
    _set_dest_circuit(db_session, dest_id, failure_threshold=2, open_seconds=60)
    sender = _StatusWebhookSender(responses=[_err_5xx(), _err_5xx()])
    for i in range(2):
        _build_runner(
            poller=_FakePoller(
                response={"items": [{"id": f"cb-e-{i}", "message": "f", "vendor": "v"}]}
            ),
            webhook_sender=sender,
        ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert get_process_destination_circuit_breaker().get_state(dest_id) == CircuitState.OPEN
    assert "circuit_opened" in _stages(db_session, seeded["stream_id"])

    get_process_destination_circuit_breaker().force_open_for_tests(
        dest_id, opened_at_monotonic=time.monotonic() - 120.0
    )
    probe_sender = _StatusWebhookSender(responses=[None])
    # Temporarily switch original stream to DIRECT to avoid recovery reclaim during probe.
    stream = db_session.query(Stream).filter(Stream.id == int(seeded["stream_id"])).one()
    cfg = dict(stream.config_json or {})
    cfg["reliability_mode"] = "DIRECT"
    stream.config_json = cfg
    db_session.commit()

    summary = _build_runner(
        poller=_FakePoller(
            response={"items": [{"id": "cb-e-probe", "message": "ok", "vendor": "v"}]}
        ),
        webhook_sender=probe_sender,
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert get_process_destination_circuit_breaker().get_state(dest_id) == CircuitState.CLOSED
    stages = _stages(db_session, seeded["stream_id"])
    assert "circuit_half_open" in stages
    assert "circuit_probe_success" in stages or "circuit_closed" in stages
    assert len(probe_sender.calls) == 1
    assert summary.get("checkpoint_updated") is True


def test_g_half_open_probe_failure_reopens(db_session: Session) -> None:
    seeded = _seed_queue_stream(
        db_session,
        dest_configs=[{"retry_count": 0, "retry_backoff_seconds": 0.01}],
    )
    dest_id = int(seeded["destination_ids"][0])
    _set_dest_circuit(db_session, dest_id, failure_threshold=2, open_seconds=60)
    sender = _StatusWebhookSender(responses=[_err_5xx(), _err_5xx()])
    for i in range(2):
        _build_runner(
            poller=_FakePoller(
                response={"items": [{"id": f"cb-g-{i}", "message": "f", "vendor": "v"}]}
            ),
            webhook_sender=sender,
        ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert get_process_destination_circuit_breaker().get_state(dest_id) == CircuitState.OPEN
    get_process_destination_circuit_breaker().force_open_for_tests(
        dest_id, opened_at_monotonic=time.monotonic() - 120.0
    )

    stream = db_session.query(Stream).filter(Stream.id == int(seeded["stream_id"])).one()
    cfg = dict(stream.config_json or {})
    cfg["reliability_mode"] = "DIRECT"
    stream.config_json = cfg
    db_session.commit()

    probe_sender = _StatusWebhookSender(responses=[_err_5xx()])
    _build_runner(
        poller=_FakePoller(
            response={"items": [{"id": "cb-g-probe", "message": "f", "vendor": "v"}]}
        ),
        webhook_sender=probe_sender,
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert get_process_destination_circuit_breaker().get_state(dest_id) == CircuitState.OPEN
    assert "circuit_probe_failed" in _stages(db_session, seeded["stream_id"])
    assert len(probe_sender.calls) == 1


def test_h_single_half_open_probe_under_concurrency() -> None:
    b = get_process_destination_circuit_breaker()
    cfg = resolve_circuit_breaker_config(
        {"circuit_breaker": {"failure_threshold": 1, "open_seconds": 0.01}}
    )
    b.record_failure(99, cfg)
    time.sleep(0.02)
    results: list[CircuitDecision] = []
    lock = threading.Lock()

    def _probe() -> None:
        decision = b.allow(99, cfg).decision
        with lock:
            results.append(decision)

    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = [pool.submit(_probe) for _ in range(8)]
        for fut in futs:
            fut.result()
    assert results.count(CircuitDecision.ALLOW_PROBE) == 1
    assert results.count(CircuitDecision.BLOCK) == 7


def test_i_destination_isolation(db_session: Session) -> None:
    seeded_a = _seed_queue_stream(
        db_session,
        dest_configs=[{"retry_count": 0, "retry_backoff_seconds": 0.01}],
    )
    seeded_b = _seed_queue_stream(
        db_session,
        dest_configs=[{"retry_count": 0, "retry_backoff_seconds": 0.01}],
    )
    dest_a = int(seeded_a["destination_ids"][0])
    dest_b = int(seeded_b["destination_ids"][0])
    _set_dest_circuit(db_session, dest_a, failure_threshold=1, open_seconds=60)
    _set_dest_circuit(db_session, dest_b, failure_threshold=5, open_seconds=60)

    bad = _StatusWebhookSender(responses=[_err_5xx()])
    good = _FakeWebhookSender()
    _build_runner(
        poller=_FakePoller(response={"items": [{"id": "iso-a", "message": "x", "vendor": "v"}]}),
        webhook_sender=bad,
    ).run(load_stream_context(db_session, seeded_a["stream_id"]), db=db_session)
    assert get_process_destination_circuit_breaker().get_state(dest_a) == CircuitState.OPEN

    summary_b = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "iso-b", "message": "ok", "vendor": "v"}]}),
        webhook_sender=good,
    ).run(load_stream_context(db_session, seeded_b["stream_id"]), db=db_session)
    assert get_process_destination_circuit_breaker().get_state(dest_b) == CircuitState.CLOSED
    assert len(good.calls) == 1
    assert summary_b.get("checkpoint_updated") is True


def test_j_webhook_connection_failure_trips_circuit(db_session: Session) -> None:
    seeded = _seed_queue_stream(
        db_session,
        dest_configs=[{"retry_count": 0, "retry_backoff_seconds": 0.01}],
    )
    dest_id = int(seeded["destination_ids"][0])
    _set_dest_circuit(db_session, dest_id, failure_threshold=2, open_seconds=30)
    sender = _StatusWebhookSender(responses=[_err_conn(), _err_conn()])
    for i in range(2):
        _build_runner(
            poller=_FakePoller(response={"items": [{"id": f"j-{i}", "message": "x", "vendor": "v"}]}),
            webhook_sender=sender,
        ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert get_process_destination_circuit_breaker().get_state(dest_id) == CircuitState.OPEN


def test_k_syslog_tcp_connection_failure_trips_circuit(db_session: Session) -> None:
    seeded = _seed_syslog_tcp_queue_stream(db_session)
    dest_id = int(seeded["destination_ids"][0])
    _set_dest_circuit(db_session, dest_id, failure_threshold=2, open_seconds=30)
    err = DestinationSendError("syslog tcp connect failed")
    err.__cause__ = ConnectionError("refused")
    sender = _StatusSyslogSender(responses=[err, err])
    for i in range(2):
        _build_syslog_runner(
            poller=_FakePoller(response={"items": [{"id": f"k-{i}", "message": "x", "vendor": "v"}]}),
            syslog_sender=sender,
        ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert get_process_destination_circuit_breaker().get_state(dest_id) == CircuitState.OPEN
    assert len(sender.calls) >= 2


def test_l_primary_open_failover_secondary_success(db_session: Session) -> None:
    seeded = _seed_queue_stream(
        db_session,
        dest_configs=[{"retry_count": 0, "retry_backoff_seconds": 0.01}],
    )
    primary_id = int(seeded["destination_ids"][0])
    _set_dest_circuit(db_session, primary_id, failure_threshold=1, open_seconds=60)

    secondary = Destination(
        name=f"cb-secondary-{seeded['stream_id']}",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://secondary.example.com/hook", "retry_count": 0},
        enabled=True,
    )
    db_session.add(secondary)
    db_session.commit()
    create_failover_route(
        db_session,
        stream_id=int(seeded["stream_id"]),
        primary_destination_id=primary_id,
        secondary_destination_id=int(secondary.id),
        enabled=True,
    )
    db_session.commit()

    # Trip primary OPEN
    _build_runner(
        poller=_FakePoller(response={"items": [{"id": "l1", "message": "x", "vendor": "v"}]}),
        webhook_sender=_StatusWebhookSender(responses=[_err_5xx()]),
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert get_process_destination_circuit_breaker().get_state(primary_id) == CircuitState.OPEN

    class _PrimaryBlockSecondaryOk:
        def __init__(self) -> None:
            self.calls: list[str] = []

        def send(self, events: list[dict[str, Any]], config: dict[str, Any], **kwargs: Any) -> None:
            url = str((config or {}).get("url") or "")
            self.calls.append(url)
            if "secondary.example.com" in url:
                return
            raise CircuitOpenError()

    sender = _PrimaryBlockSecondaryOk()
    get_process_destination_circuit_breaker().force_open_for_tests(primary_id)
    summary = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "l2", "message": "ok", "vendor": "v"}]}),
        webhook_sender=sender,  # type: ignore[arg-type]
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert any("secondary.example.com" in u for u in sender.calls)
    assert summary.get("checkpoint_updated") is True or any(
        r.status == QUEUE_STATUS_DELIVERED for r in _queue_rows(db_session, seeded["stream_id"])
    )


def test_m_circuit_open_with_backpressure(db_session: Session) -> None:
    seeded = _seed_queue_stream(
        db_session,
        dest_configs=[{"retry_count": 0, "retry_backoff_seconds": 0.01}],
    )
    dest_id = int(seeded["destination_ids"][0])
    _set_dest_circuit(db_session, dest_id, failure_threshold=1, open_seconds=60)
    _set_backpressure_config(
        db_session,
        int(seeded["stream_id"]),
        max_pending_items=2,
        resume_pending_items=1,
    )
    sender = _StatusWebhookSender(responses=[_err_5xx()] + [None] * 5)
    for i in range(3):
        _build_runner(
            poller=_FakePoller(response={"items": [{"id": f"m-{i}", "message": "x", "vendor": "v"}]}),
            webhook_sender=sender,
        ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert get_process_destination_circuit_breaker().get_state(dest_id) == CircuitState.OPEN
    stages = _stages(db_session, seeded["stream_id"])
    assert "circuit_opened" in stages or "circuit_request_blocked" in stages
    assert len(_queue_rows(db_session, seeded["stream_id"])) >= 1


def test_n_restart_resets_circuit_keeps_queue(db_session: Session) -> None:
    seeded = _seed_queue_stream(
        db_session,
        dest_configs=[{"retry_count": 0, "retry_backoff_seconds": 0.01}],
    )
    dest_id = int(seeded["destination_ids"][0])
    _set_dest_circuit(db_session, dest_id, failure_threshold=1, open_seconds=60)
    _build_runner(
        poller=_FakePoller(response={"items": [{"id": "n1", "message": "x", "vendor": "v"}]}),
        webhook_sender=_StatusWebhookSender(responses=[_err_5xx()]),
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    rows_before = _queue_rows(db_session, seeded["stream_id"])
    assert rows_before
    assert get_process_destination_circuit_breaker().get_state(dest_id) == CircuitState.OPEN
    reset_process_destination_circuit_breaker_for_tests()
    assert get_process_destination_circuit_breaker().get_state(dest_id) == CircuitState.CLOSED
    assert len(_queue_rows(db_session, seeded["stream_id"])) == len(rows_before)


def test_o_http_resilience_429_does_not_open_circuit(db_session: Session) -> None:
    seeded = _seed_queue_stream(
        db_session,
        dest_configs=[{"retry_count": 2, "retry_backoff_seconds": 0.01}],
    )
    dest_id = int(seeded["destination_ids"][0])
    _set_dest_circuit(db_session, dest_id, failure_threshold=1, open_seconds=60)
    _build_runner(
        poller=_FakePoller(response={"items": [{"id": "o1", "message": "x", "vendor": "v"}]}),
        webhook_sender=_StatusWebhookSender(
            responses=[DestinationSendError("rl", http_status=429, retry_after_seconds=1.0)]
        ),
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert get_process_destination_circuit_breaker().get_state(dest_id) == CircuitState.CLOSED
    assert _queue_rows(db_session, seeded["stream_id"])[0].status == QUEUE_STATUS_RETRY_WAIT


def test_p_restart_recovery_keeps_pending(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    dest_id = int(seeded["destination_ids"][0])
    _set_dest_circuit(db_session, dest_id, failure_threshold=5, open_seconds=30)
    sender = _StatusWebhookSender(responses=[_err_5xx(), None])
    _build_runner(
        poller=_FakePoller(response={"items": [{"id": "p1", "message": "x", "vendor": "v"}]}),
        webhook_sender=sender,
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    _build_runner(
        poller=_FakePoller(response={"items": []}),
        webhook_sender=sender,
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    rows = _queue_rows(db_session, seeded["stream_id"])
    assert rows
    assert all(
        r.status in {QUEUE_STATUS_DELIVERED, QUEUE_STATUS_RETRY_WAIT, QUEUE_STATUS_PENDING}
        for r in rows
    )


def test_q_checkpoint_held_while_open(db_session: Session) -> None:
    seeded = _seed_queue_stream(
        db_session,
        dest_configs=[{"retry_count": 0, "retry_backoff_seconds": 0.01}],
    )
    dest_id = int(seeded["destination_ids"][0])
    _set_dest_circuit(db_session, dest_id, failure_threshold=1, open_seconds=60)
    before = _checkpoint_value(db_session, seeded["stream_id"])
    summary = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "q1", "message": "x", "vendor": "v"}]}),
        webhook_sender=_StatusWebhookSender(responses=[_err_5xx()]),
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is False
    assert _checkpoint_value(db_session, seeded["stream_id"]) == before


def test_r_direct_mode_success_and_circuit_block(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    sender = _FakeWebhookSender()
    summary = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "r1", "message": "ok", "vendor": "v"}]}),
        webhook_sender=sender,
        source_limiter=_AllowAllLimiter(),
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is True
    assert len(sender.calls) == 1
    assert _queue_rows(db_session, seeded["stream_id"]) == []

    dest_id = int(seeded["destination_ids"][0])
    _set_dest_circuit(db_session, dest_id, failure_threshold=1, open_seconds=60)
    status_sender = _StatusWebhookSender(responses=[_err_5xx(), _err_5xx()])
    _build_runner(
        poller=_FakePoller(response={"items": [{"id": "r2", "message": "x", "vendor": "v"}]}),
        webhook_sender=status_sender,
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert get_process_destination_circuit_breaker().get_state(dest_id) == CircuitState.OPEN
    calls = len(status_sender.calls)
    _build_runner(
        poller=_FakePoller(response={"items": [{"id": "r3", "message": "x", "vendor": "v"}]}),
        webhook_sender=status_sender,
    ).run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert len(status_sender.calls) == calls
