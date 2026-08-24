"""Durable Delivery Queue Phase 4 — SYSLOG_TCP Destination integration tests.

Extends the shared queue lifecycle to SYSLOG_TCP only. SYSLOG_UDP / SYSLOG_TLS /
AI_PROVIDER_POST remain DIRECT. Reuses Phase 2/3 claim → I/O → DELIVERED|RETRY_WAIT
paths (no parallel queue engine).
"""

from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session, sessionmaker

from app.delivery_queue.models import (
    DELIVERY_KIND_BASE_ROUTE,
    DELIVERY_KIND_FAILOVER_SECONDARY,
    QUEUE_STATUS_DELIVERED,
    QUEUE_STATUS_IN_FLIGHT,
    QUEUE_STATUS_PENDING,
    QUEUE_STATUS_RETRY_WAIT,
    StreamDeliveryQueueItem,
)
from app.delivery_queue.repository import (
    claim_next,
    enqueue,
    get_queue_item,
    mark_delivered,
)
from app.destinations.models import Destination
from app.failover_routing.operator_workflow import create_failover_route
from app.logs.models import DeliveryLog
from app.runtime.errors import DestinationSendError
from app.runners.stream_loader import load_stream_context
from app.runners.stream_runner import StreamRunner
from app.streams.models import Stream
from tests.test_delivery_queue_webhook_phase2 import (
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


class _OkSyslogSender:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def send(self, events, config, formatter_override=None, **kwargs):
        self.calls.append(
            {
                "events": events,
                "config": config,
                "destination_type": kwargs.get("destination_type"),
            }
        )


class _StatusSyslogSender:
    """Raises DestinationSendError (transport-style) then optionally succeeds."""

    def __init__(self, *, responses: list[DestinationSendError | None]) -> None:
        self.responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def send(self, events, config, formatter_override=None, **kwargs):
        self.calls.append({"events": events, "config": config})
        if not self.responses:
            return
        nxt = self.responses.pop(0)
        if nxt is not None:
            raise nxt


class _InstrumentedSyslogSender:
    """Records whether caller Session is mid-transaction during syslog I/O."""

    def __init__(self, *, hold_s: float = 0.05) -> None:
        self.hold_s = hold_s
        self.calls: list[dict[str, Any]] = []
        self.caller_db: Session | None = None
        self.observed_caller_in_transaction: list[bool] = []
        self.in_send = threading.Event()

    def send(self, events, config, formatter_override=None, **kwargs):
        self.calls.append({"events": events, "config": config})
        db = self.caller_db
        if db is not None and hasattr(db, "in_transaction"):
            self.observed_caller_in_transaction.append(bool(db.in_transaction()))
        self.in_send.set()
        if self.hold_s > 0:
            threading.Event().wait(timeout=self.hold_s)


def _enable_persistent_queue(db: Session, stream_id: int) -> None:
    stream = db.query(Stream).filter(Stream.id == int(stream_id)).one()
    cfg = dict(stream.config_json or {})
    cfg["reliability_mode"] = "PERSISTENT_QUEUE"
    stream.config_json = cfg
    db.commit()


def _seed_syslog_tcp_queue_stream(
    db: Session,
    *,
    failure_policies: list[str] | None = None,
    dest_configs: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    seeded = _seed_stream_runtime(db, failure_policies=failure_policies)
    _enable_persistent_queue(db, seeded["stream_id"])
    for idx, dest_id in enumerate(seeded["destination_ids"]):
        dest = db.query(Destination).filter(Destination.id == dest_id).one()
        dest.destination_type = "SYSLOG_TCP"
        cfg = {"host": "127.0.0.1", "port": 1514, "retry_count": 2, "retry_backoff_seconds": 0.01}
        if dest_configs and idx < len(dest_configs):
            cfg.update(dest_configs[idx])
        dest.config_json = cfg
    db.commit()
    return seeded


def _build_syslog_runner(
    *,
    poller: _FakePoller,
    syslog_sender: Any,
    webhook_sender: Any | None = None,
) -> StreamRunner:
    return StreamRunner(
        poller=poller,
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        webhook_sender=webhook_sender if webhook_sender is not None else _FakeWebhookSender(),
        syslog_sender=syslog_sender,
    )


def _seed_pending_syslog_item(
    db: Session, seeded: dict[str, Any], *, events: list[dict] | None = None
) -> StreamDeliveryQueueItem:
    return enqueue(
        db,
        stream_id=int(seeded["stream_id"]),
        route_id=int(seeded["route_ids"][0]),
        destination_id=int(seeded["destination_ids"][0]),
        batch_id=str(uuid.uuid4()),
        delivery_kind=DELIVERY_KIND_BASE_ROUTE,
        payload=events or [{"event_id": "sys-rec-1", "message": "recover", "vendor": "v"}],
    )


# --- Normal queue-backed delivery ---


def test_syslog_tcp_normal_enqueue_claim_delivered_checkpoint(db_session: Session) -> None:
    seeded = _seed_syslog_tcp_queue_stream(db_session)
    before = _checkpoint_value(db_session, seeded["stream_id"])
    syslog = _OkSyslogSender()
    runner = _build_syslog_runner(
        poller=_FakePoller(response={"items": [{"id": "sys-a-1", "message": "ok", "vendor": "v"}]}),
        syslog_sender=syslog,
    )
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    run_id = str(summary["run_id"])
    assert summary.get("checkpoint_updated") is True
    assert _checkpoint_value(db_session, seeded["stream_id"]) != before
    rows = _queue_rows(db_session, seeded["stream_id"])
    assert len(rows) == 1
    assert rows[0].status == QUEUE_STATUS_DELIVERED
    assert rows[0].delivery_kind == DELIVERY_KIND_BASE_ROUTE
    assert len(syslog.calls) == 1
    assert syslog.calls[0].get("destination_type") == "SYSLOG_TCP"
    stages = _stages(db_session, seeded["stream_id"], run_id)
    assert {
        "queue_enqueued",
        "queue_claimed",
        "queue_delivered",
        "route_send_success",
        "checkpoint_update",
    } <= stages


def test_syslog_tcp_queue_persisted_before_io(db_session: Session) -> None:
    """Enqueue completes before syslog send (queue row exists when I/O starts)."""

    seeded = _seed_syslog_tcp_queue_stream(db_session)
    order: list[str] = []
    real_enqueue = enqueue

    def _tracked_enqueue(db, *args, **kwargs):
        order.append("enqueue")
        return real_enqueue(db, *args, **kwargs)

    class _OrderedSyslog(_OkSyslogSender):
        def send(self, events, config, formatter_override=None, **kwargs):
            order.append("io")
            rows = (
                db_session.query(StreamDeliveryQueueItem)
                .filter(StreamDeliveryQueueItem.stream_id == int(seeded["stream_id"]))
                .all()
            )
            assert rows, "queue must be persisted before destination I/O"
            assert rows[0].status in {QUEUE_STATUS_PENDING, QUEUE_STATUS_IN_FLIGHT}
            super().send(events, config, formatter_override=formatter_override, **kwargs)

    syslog = _OrderedSyslog()
    runner = _build_syslog_runner(
        poller=_FakePoller(response={"items": [{"id": "sys-before", "message": "x", "vendor": "v"}]}),
        syslog_sender=syslog,
    )
    with patch("app.delivery_queue.repository.enqueue", side_effect=_tracked_enqueue):
        summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)

    assert summary.get("checkpoint_updated") is True
    assert order[0] == "enqueue"
    assert "io" in order
    assert order.index("enqueue") < order.index("io")


def test_syslog_tcp_queue_persist_failure_blocks_io_and_checkpoint(db_session: Session) -> None:
    seeded = _seed_syslog_tcp_queue_stream(db_session)
    before = _checkpoint_value(db_session, seeded["stream_id"])
    syslog = _OkSyslogSender()
    runner = _build_syslog_runner(
        poller=_FakePoller(response={"items": [{"id": "sys-b-1", "message": "x", "vendor": "v"}]}),
        syslog_sender=syslog,
    )
    with patch("app.delivery_queue.repository.enqueue", side_effect=RuntimeError("enqueue boom")):
        summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)

    assert summary.get("checkpoint_updated") is False
    assert syslog.calls == []
    assert _queue_rows(db_session, seeded["stream_id"]) == []
    assert _checkpoint_value(db_session, seeded["stream_id"]) == before


def test_syslog_tcp_transient_failure_retry_wait_checkpoint_held(db_session: Session) -> None:
    seeded = _seed_syslog_tcp_queue_stream(
        db_session,
        failure_policies=["PAUSE_STREAM_ON_FAILURE"],
        dest_configs=[{"retry_count": 2, "retry_backoff_seconds": 0.01}],
    )
    before = _checkpoint_value(db_session, seeded["stream_id"])
    err = DestinationSendError("Syslog send failed: Connection refused")
    err.__cause__ = OSError("Connection refused")
    syslog = _StatusSyslogSender(responses=[err])
    runner = _build_syslog_runner(
        poller=_FakePoller(response={"items": [{"id": "sys-c-1", "message": "t", "vendor": "v"}]}),
        syslog_sender=syslog,
    )
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is False
    assert _checkpoint_value(db_session, seeded["stream_id"]) == before
    rows = _queue_rows(db_session, seeded["stream_id"])
    assert len(rows) == 1
    assert rows[0].status == QUEUE_STATUS_RETRY_WAIT
    stages = _stages(db_session, seeded["stream_id"], str(summary["run_id"]))
    assert "queue_retry_wait" in stages
    assert "checkpoint_update" not in stages


def test_syslog_tcp_recovery_then_delivered_checkpoint_advance(db_session: Session) -> None:
    seeded = _seed_syslog_tcp_queue_stream(
        db_session,
        failure_policies=["PAUSE_STREAM_ON_FAILURE"],
        dest_configs=[{"retry_count": 2, "retry_backoff_seconds": 0.01}],
    )
    before = _checkpoint_value(db_session, seeded["stream_id"])
    err = DestinationSendError("Syslog send failed: temporary")
    err.__cause__ = ConnectionError("reset")
    syslog = _StatusSyslogSender(responses=[err, None])
    runner = _build_syslog_runner(
        poller=_FakePoller(response={"items": [{"id": "sys-rec-live", "message": "r", "vendor": "v"}]}),
        syslog_sender=syslog,
    )
    summary1 = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary1.get("checkpoint_updated") is False
    row = _queue_rows(db_session, seeded["stream_id"])[0]
    assert row.status == QUEUE_STATUS_RETRY_WAIT
    # Make available immediately for next-run recovery.
    row.available_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()

    runner2 = _build_syslog_runner(
        poller=_FakePoller(response={"items": []}),
        syslog_sender=syslog,
    )
    summary2 = runner2.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert _queue_rows(db_session, seeded["stream_id"])[0].status == QUEUE_STATUS_DELIVERED
    assert summary2.get("checkpoint_updated") is True
    assert _checkpoint_value(db_session, seeded["stream_id"]) != before
    assert len(syslog.calls) == 2


def test_syslog_tcp_delivered_persist_failure_holds_checkpoint(db_session: Session) -> None:
    seeded = _seed_syslog_tcp_queue_stream(db_session)
    before = _checkpoint_value(db_session, seeded["stream_id"])
    syslog = _OkSyslogSender()
    runner = _build_syslog_runner(
        poller=_FakePoller(response={"items": [{"id": "sys-g-1", "message": "g", "vendor": "v"}]}),
        syslog_sender=syslog,
    )
    with patch(
        "app.delivery_queue.repository.mark_delivered",
        side_effect=RuntimeError("delivered boom"),
    ):
        summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert len(syslog.calls) == 1
    assert summary.get("checkpoint_updated") is False
    assert _checkpoint_value(db_session, seeded["stream_id"]) == before
    row = _queue_rows(db_session, seeded["stream_id"])[0]
    assert row.status != QUEUE_STATUS_DELIVERED


def test_syslog_tcp_process_session_end_persistence(db_session: Session, db_engine) -> None:
    seeded = _seed_syslog_tcp_queue_stream(
        db_session,
        failure_policies=["PAUSE_STREAM_ON_FAILURE"],
        dest_configs=[{"retry_count": 2}],
    )
    syslog = _StatusSyslogSender(
        responses=[DestinationSendError("Syslog send failed: down")]
    )
    runner = _build_syslog_runner(
        poller=_FakePoller(response={"items": [{"id": "sys-j-1", "message": "persist", "vendor": "v"}]}),
        syslog_sender=syslog,
    )
    runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    rows = _queue_rows(db_session, seeded["stream_id"])
    assert len(rows) == 1
    item_id = int(rows[0].id)
    assert rows[0].status == QUEUE_STATUS_RETRY_WAIT
    db_session.commit()
    db_session.close()

    Fresh = sessionmaker(bind=db_engine)
    with Fresh() as fresh:
        loaded = get_queue_item(fresh, item_id)
        assert loaded is not None
        assert loaded.status == QUEUE_STATUS_RETRY_WAIT
        assert loaded.payload_json.get("events")


def test_syslog_tcp_runtime_restart_recovery(db_session: Session) -> None:
    seeded = _seed_syslog_tcp_queue_stream(db_session)
    before = _checkpoint_value(db_session, seeded["stream_id"])
    row = _seed_pending_syslog_item(
        db_session,
        seeded,
        events=[{"event_id": "pending-sys", "message": "p", "vendor": "v", "id": "pending-sys"}],
    )
    db_session.commit()
    assert row.status == QUEUE_STATUS_PENDING

    syslog = _OkSyslogSender()
    runner = _build_syslog_runner(
        poller=_FakePoller(response={"items": []}),
        syslog_sender=syslog,
    )
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert _queue_rows(db_session, seeded["stream_id"])[0].status == QUEUE_STATUS_DELIVERED
    assert len(syslog.calls) == 1
    assert summary.get("checkpoint_updated") is True
    assert _checkpoint_value(db_session, seeded["stream_id"]) != before
    stages = _stages(db_session, seeded["stream_id"], str(summary["run_id"]))
    assert {
        "queue_recovery_started",
        "queue_recovery_claimed",
        "queue_delivered",
        "recovery_success",
        "checkpoint_update",
    } <= stages


def test_syslog_tcp_delivered_no_redelivery(db_session: Session) -> None:
    seeded = _seed_syslog_tcp_queue_stream(db_session)
    row = _seed_pending_syslog_item(db_session, seeded)
    claimed = claim_next(db_session, lease_owner="w")
    assert claimed is not None
    mark_delivered(db_session, int(claimed.id))
    db_session.commit()

    syslog = _OkSyslogSender()
    runner = _build_syslog_runner(
        poller=_FakePoller(response={"items": []}),
        syslog_sender=syslog,
    )
    runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert syslog.calls == []
    assert get_queue_item(db_session, int(row.id)).status == QUEUE_STATUS_DELIVERED
    assert claim_next(db_session, lease_owner="w2", stream_id=seeded["stream_id"]) is None


def test_syslog_tcp_concurrent_double_claim_prevented(db_session: Session, db_engine) -> None:
    seeded = _seed_syslog_tcp_queue_stream(db_session)
    row = _seed_pending_syslog_item(db_session, seeded)
    item_id = int(row.id)
    db_session.commit()
    SessionLocal = sessionmaker(bind=db_engine, expire_on_commit=False)
    barrier = threading.Barrier(2)
    results: list[int | None] = []
    lock = threading.Lock()

    def _worker(owner: str) -> None:
        session = SessionLocal()
        try:
            barrier.wait(timeout=5)
            claimed = claim_next(session, lease_owner=owner, stream_id=seeded["stream_id"])
            session.commit()
            with lock:
                results.append(int(claimed.id) if claimed is not None else None)
        finally:
            session.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futs = [pool.submit(_worker, "sys-w1"), pool.submit(_worker, "sys-w2")]
        for fut in as_completed(futs):
            fut.result()

    assert results.count(item_id) == 1
    assert results.count(None) == 1


def test_syslog_tcp_observability_correlation(db_session: Session) -> None:
    seeded = _seed_syslog_tcp_queue_stream(db_session)
    syslog = _OkSyslogSender()
    runner = _build_syslog_runner(
        poller=_FakePoller(response={"items": [{"id": "sys-corr", "message": "c", "vendor": "v"}]}),
        syslog_sender=syslog,
    )
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    run_id = str(summary["run_id"])
    rows = (
        db_session.query(DeliveryLog)
        .filter(DeliveryLog.stream_id == seeded["stream_id"], DeliveryLog.run_id == run_id)
        .all()
    )
    assert rows
    assert all(r.run_id == run_id for r in rows)
    claimed = [r for r in rows if r.stage == "queue_claimed"]
    delivered = [r for r in rows if r.stage == "queue_delivered"]
    attempt_rows = [r for r in rows if r.stage == "delivery_attempt"]
    assert claimed
    assert delivered
    assert attempt_rows
    assert claimed[0].route_id == seeded["route_ids"][0]
    assert claimed[0].destination_id == seeded["destination_ids"][0]
    assert attempt_rows[0].retry_count >= 1
    sample = attempt_rows[0].payload_sample or {}
    assert sample.get("stream_id") == seeded["stream_id"] or attempt_rows[0].stream_id == seeded["stream_id"]


def test_syslog_tcp_direct_mode_unchanged(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)  # DIRECT, webhook by default
    dest = db_session.query(Destination).filter(Destination.id == seeded["destination_ids"][0]).one()
    dest.destination_type = "SYSLOG_TCP"
    dest.config_json = {"host": "127.0.0.1", "port": 1514}
    db_session.commit()

    syslog = _OkSyslogSender()
    runner = _build_syslog_runner(
        poller=_FakePoller(response={"items": [{"id": "direct-sys", "message": "d", "vendor": "v"}]}),
        syslog_sender=syslog,
    )
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is True
    assert len(syslog.calls) == 1
    assert _queue_rows(db_session, seeded["stream_id"]) == []
    stages = _stages(db_session, seeded["stream_id"], str(summary["run_id"]))
    assert "queue_enqueued" not in stages


def test_syslog_udp_still_not_queue_backed(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    dest = db_session.query(Destination).filter(Destination.id == seeded["destination_ids"][0]).one()
    dest.destination_type = "SYSLOG_UDP"
    dest.config_json = {"host": "127.0.0.1", "port": 514}
    db_session.commit()

    syslog = _OkSyslogSender()
    runner = _build_syslog_runner(
        poller=_FakePoller(response={"items": [{"id": "udp-1", "message": "u", "vendor": "v"}]}),
        syslog_sender=syslog,
    )
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is True
    assert len(syslog.calls) == 1
    assert _queue_rows(db_session, seeded["stream_id"]) == []


def test_syslog_tls_still_not_queue_backed(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    dest = db_session.query(Destination).filter(Destination.id == seeded["destination_ids"][0]).one()
    dest.destination_type = "SYSLOG_TLS"
    dest.config_json = {
        "host": "127.0.0.1",
        "port": 6514,
        "tls_enabled": True,
        "tls_verify_mode": "insecure_skip_verify",
    }
    db_session.commit()

    syslog = _OkSyslogSender()
    runner = _build_syslog_runner(
        poller=_FakePoller(response={"items": [{"id": "tls-1", "message": "t", "vendor": "v"}]}),
        syslog_sender=syslog,
    )
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is True
    assert len(syslog.calls) == 1
    assert _queue_rows(db_session, seeded["stream_id"]) == []


def test_webhook_queue_regression_still_works(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    before = _checkpoint_value(db_session, seeded["stream_id"])
    sender = _FakeWebhookSender()
    runner = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "wh-reg", "message": "ok", "vendor": "v"}]}),
        webhook_sender=sender,
    )
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is True
    assert _checkpoint_value(db_session, seeded["stream_id"]) != before
    assert _queue_rows(db_session, seeded["stream_id"])[0].status == QUEUE_STATUS_DELIVERED
    assert len(sender.calls) == 1
    assert "X-Data-Relay-Delivery-Id" in (sender.calls[0]["config"].get("headers") or {})


def test_syslog_tcp_failover_primary_fail_secondary_success(db_session: Session) -> None:
    seeded = _seed_syslog_tcp_queue_stream(
        db_session,
        failure_policies=["PAUSE_STREAM_ON_FAILURE"],
    )
    primary = db_session.query(Destination).filter(Destination.id == seeded["destination_ids"][0]).one()
    backup = Destination(
        name=f"ddq-sys-backup-{uuid.uuid4().hex[:8]}",
        destination_type="SYSLOG_TCP",
        config_json={"host": "127.0.0.1", "port": 2514, "retry_count": 0},
        rate_limit_json={"max_events": 100, "per_seconds": 1},
        enabled=True,
    )
    db_session.add(backup)
    db_session.flush()
    create_failover_route(
        db_session,
        stream_id=seeded["stream_id"],
        primary_destination_id=int(primary.id),
        secondary_destination_id=int(backup.id),
        enabled=True,
    )
    db_session.commit()

    before = _checkpoint_value(db_session, seeded["stream_id"])
    primary_port = int((primary.config_json or {}).get("port") or 1514)

    class _FailoverSyslog:
        def __init__(self) -> None:
            self.calls: list[dict[str, Any]] = []

        def send(self, events, config, formatter_override=None, **kwargs):
            self.calls.append({"config": config})
            port = int(config.get("port") or 0)
            if port == primary_port:
                raise DestinationSendError("Syslog send failed: primary down")

    syslog = _FailoverSyslog()
    runner = _build_syslog_runner(
        poller=_FakePoller(response={"items": [{"id": "sys-fo", "message": "fo", "vendor": "v"}]}),
        syslog_sender=syslog,
    )
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is True
    assert _checkpoint_value(db_session, seeded["stream_id"]) != before
    row = _queue_rows(db_session, seeded["stream_id"])[0]
    assert row.status == QUEUE_STATUS_DELIVERED
    assert row.destination_id == int(backup.id)
    assert row.delivery_kind == DELIVERY_KIND_FAILOVER_SECONDARY
    assert len(syslog.calls) >= 2


def test_syslog_tcp_db_session_inactive_during_io(db_session: Session) -> None:
    seeded = _seed_syslog_tcp_queue_stream(db_session)
    syslog = _InstrumentedSyslogSender(hold_s=0.05)
    syslog.caller_db = db_session
    runner = _build_syslog_runner(
        poller=_FakePoller(response={"items": [{"id": "sys-sess", "message": "s", "vendor": "v"}]}),
        syslog_sender=syslog,
    )
    runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert syslog.calls
    assert syslog.observed_caller_in_transaction
    assert all(active is False for active in syslog.observed_caller_in_transaction)


def test_syslog_tcp_stale_inflight_recovery(db_session: Session) -> None:
    seeded = _seed_syslog_tcp_queue_stream(db_session)
    row = _seed_pending_syslog_item(
        db_session,
        seeded,
        events=[{"event_id": "stale-1", "message": "s", "vendor": "v", "id": "stale-1"}],
    )
    claimed = claim_next(db_session, lease_owner="owner-a", lease_seconds=30)
    assert claimed is not None
    claimed.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=5)
    db_session.commit()

    syslog = _OkSyslogSender()
    runner = _build_syslog_runner(
        poller=_FakePoller(response={"items": []}),
        syslog_sender=syslog,
    )
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert get_queue_item(db_session, int(row.id)).status == QUEUE_STATUS_DELIVERED
    assert len(syslog.calls) == 1
    assert summary.get("checkpoint_updated") is True
    stages = _stages(db_session, seeded["stream_id"], str(summary["run_id"]))
    assert "stale_inflight_recovered" in stages or "queue_recovery_claimed" in stages


def test_uses_durable_destination_queue_helpers() -> None:
    from app.delivery_queue.reliability import (
        is_durable_queue_destination_type,
        uses_durable_destination_queue,
    )

    stream_pq = {"config_json": {"reliability_mode": "PERSISTENT_QUEUE"}}
    stream_direct = {"config_json": {"reliability_mode": "DIRECT"}}
    assert is_durable_queue_destination_type("SYSLOG_TCP")
    assert is_durable_queue_destination_type("WEBHOOK_POST")
    assert not is_durable_queue_destination_type("SYSLOG_UDP")
    assert not is_durable_queue_destination_type("SYSLOG_TLS")
    assert not is_durable_queue_destination_type("AI_PROVIDER_POST")
    assert uses_durable_destination_queue(stream_pq, "SYSLOG_TCP")
    assert uses_durable_destination_queue(stream_pq, "WEBHOOK_POST")
    assert not uses_durable_destination_queue(stream_pq, "SYSLOG_UDP")
    assert not uses_durable_destination_queue(stream_direct, "SYSLOG_TCP")
