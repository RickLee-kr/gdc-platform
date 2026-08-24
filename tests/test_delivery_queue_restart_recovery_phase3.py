"""Durable Delivery Queue Phase 3 — Runtime Restart Recovery tests.

Exercises real claim/lease + StreamRunner recovery paths (not repository-only mocks).
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
    QUEUE_STATUS_DELIVERED,
    QUEUE_STATUS_EXHAUSTED,
    QUEUE_STATUS_IN_FLIGHT,
    QUEUE_STATUS_PENDING,
    QUEUE_STATUS_RETRY_WAIT,
    StreamDeliveryQueueItem,
)
from app.delivery_queue.repository import (
    claim_next,
    claim_next_detailed,
    enqueue,
    force_expire_inflight_leases,
    get_queue_item,
    mark_delivered,
    mark_exhausted,
    mark_retry_wait,
)
from app.destinations.models import Destination
from app.failover_routing.operator_workflow import create_failover_route
from app.logs.models import DeliveryLog
from app.runners.stream_loader import load_stream_context
from app.runners.stream_runner import StreamRunner
from app.runtime.errors import DestinationSendError
from tests.e2e_wiremock_helpers import DEFAULT_WIREMOCK, wiremock_reachable
from tests.test_delivery_queue_webhook_phase2 import (
    _StatusWebhookSender,
    _queue_rows,
    _seed_queue_stream,
    _stages,
)
from tests.test_failover_routing_m10 import _FailoverWebhookSender
from tests.test_stream_runner_e2e import (
    _AllowAllLimiter,
    _FakePoller,
    _FakeWebhookSender,
    _build_runner,
    _checkpoint_value,
    _seed_stream_runtime,
)

pytestmark = [pytest.mark.e2e_checkpoint, pytest.mark.e2e_delivery]

skip_no_wiremock = pytest.mark.skipif(
    not wiremock_reachable(DEFAULT_WIREMOCK),
    reason=f"WireMock not reachable at {DEFAULT_WIREMOCK}",
)


def _seed_pending_item(db: Session, seeded: dict[str, Any], *, events: list[dict] | None = None) -> StreamDeliveryQueueItem:
    return enqueue(
        db,
        stream_id=int(seeded["stream_id"]),
        route_id=int(seeded["route_ids"][0]),
        destination_id=int(seeded["destination_ids"][0]),
        batch_id=str(uuid.uuid4()),
        delivery_kind=DELIVERY_KIND_BASE_ROUTE,
        payload=events or [{"event_id": "rec-1", "message": "recover", "vendor": "v"}],
    )


# --- Repository: stale / fresh / concurrent ---


def test_stale_inflight_reclaim(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    row = _seed_pending_item(db_session, seeded)
    claimed = claim_next(db_session, lease_owner="owner-a", lease_seconds=30)
    assert claimed is not None
    claimed.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=5)
    db_session.commit()

    detailed = claim_next_detailed(db_session, lease_owner="owner-b", stream_id=seeded["stream_id"])
    db_session.commit()
    assert detailed is not None
    assert detailed.recovered_stale_inflight is True
    assert detailed.item.id == row.id
    assert detailed.item.lease_owner == "owner-b"
    assert detailed.item.attempt_count == 2


def test_fresh_inflight_not_stolen(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    _seed_pending_item(db_session, seeded)
    claimed = claim_next(db_session, lease_owner="owner-a", lease_seconds=600)
    db_session.commit()
    assert claimed is not None
    assert claimed.status == QUEUE_STATUS_IN_FLIGHT

    assert claim_next(db_session, lease_owner="owner-b", stream_id=seeded["stream_id"]) is None
    db_session.expire_all()
    refreshed = get_queue_item(db_session, int(claimed.id))
    assert refreshed is not None
    assert refreshed.lease_owner == "owner-a"


def test_concurrent_recovery_workers_double_claim_prevented(db_session: Session, db_engine) -> None:
    seeded = _seed_queue_stream(db_session)
    row = _seed_pending_item(db_session, seeded)
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
        futs = [pool.submit(_worker, "rec-w1"), pool.submit(_worker, "rec-w2")]
        for fut in as_completed(futs):
            fut.result()

    assert results.count(item_id) == 1
    assert results.count(None) == 1


def test_delivered_and_exhausted_not_redelivered(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    delivered = _seed_pending_item(db_session, seeded, events=[{"event_id": "d1", "message": "x", "vendor": "v"}])
    c1 = claim_next(db_session, lease_owner="w")
    assert c1 is not None
    mark_delivered(db_session, int(c1.id))
    exhausted = _seed_pending_item(db_session, seeded, events=[{"event_id": "e1", "message": "x", "vendor": "v"}])
    c2 = claim_next(db_session, lease_owner="w")
    assert c2 is not None
    mark_exhausted(db_session, int(c2.id), last_error="done")
    db_session.commit()

    assert claim_next(db_session, lease_owner="w2", stream_id=seeded["stream_id"]) is None
    assert get_queue_item(db_session, int(delivered.id)).status == QUEUE_STATUS_DELIVERED
    assert get_queue_item(db_session, int(exhausted.id)).status == QUEUE_STATUS_EXHAUSTED


# --- Runtime recovery via StreamRunner ---


def test_pending_survives_restart_and_delivers(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    before = _checkpoint_value(db_session, seeded["stream_id"])
    row = _seed_pending_item(
        db_session,
        seeded,
        events=[{"event_id": "pending-1", "message": "p", "vendor": "v", "id": "pending-1"}],
    )
    db_session.commit()
    assert row.status == QUEUE_STATUS_PENDING

    sender = _FakeWebhookSender()
    # Empty fetch — recovery should deliver pending without new enqueue.
    runner = _build_runner(poller=_FakePoller(response={"items": []}), webhook_sender=sender)
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)

    rows = _queue_rows(db_session, seeded["stream_id"])
    assert len(rows) == 1
    assert rows[0].status == QUEUE_STATUS_DELIVERED
    assert len(sender.calls) == 1
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


def test_retry_wait_survives_restart_after_available_at(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    before = _checkpoint_value(db_session, seeded["stream_id"])
    row = _seed_pending_item(
        db_session,
        seeded,
        events=[{"event_id": "rw-1", "message": "r", "vendor": "v", "id": "rw-1"}],
    )
    claimed = claim_next(db_session, lease_owner="w")
    assert claimed is not None
    mark_retry_wait(
        db_session,
        int(claimed.id),
        available_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        last_error="503",
    )
    db_session.commit()

    sender = _FakeWebhookSender()
    runner = _build_runner(poller=_FakePoller(response={"items": []}), webhook_sender=sender)
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert _queue_rows(db_session, seeded["stream_id"])[0].status == QUEUE_STATUS_DELIVERED
    assert len(sender.calls) == 1
    assert summary.get("checkpoint_updated") is True
    assert _checkpoint_value(db_session, seeded["stream_id"]) != before
    assert "recovery_success" in _stages(db_session, seeded["stream_id"], str(summary["run_id"]))


def test_retry_wait_available_at_gating_blocks_recovery(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    before = _checkpoint_value(db_session, seeded["stream_id"])
    row = _seed_pending_item(db_session, seeded)
    claimed = claim_next(db_session, lease_owner="w")
    assert claimed is not None
    mark_retry_wait(
        db_session,
        int(claimed.id),
        available_at=datetime.now(timezone.utc) + timedelta(hours=1),
        last_error="429",
    )
    db_session.commit()

    sender = _FakeWebhookSender()
    poller = _FakePoller(response={"items": [{"id": "should-not-fetch", "message": "x", "vendor": "v"}]})
    runner = _build_runner(poller=poller, webhook_sender=sender)
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)

    assert sender.calls == []
    assert poller.calls == []  # fetch skipped while undelivered remain
    assert _queue_rows(db_session, seeded["stream_id"])[0].status == QUEUE_STATUS_RETRY_WAIT
    assert _checkpoint_value(db_session, seeded["stream_id"]) == before
    assert summary.get("outcome") == "durable_queue_recovery"
    stages = _stages(db_session, seeded["stream_id"], str(summary["run_id"]))
    assert "queue_recovery_started" in stages
    assert "queue_recovery_claimed" not in stages
    assert "checkpoint_held" in stages


def test_stale_inflight_recovery_delivers(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    before = _checkpoint_value(db_session, seeded["stream_id"])
    row = _seed_pending_item(
        db_session,
        seeded,
        events=[{"event_id": "stale-1", "message": "s", "vendor": "v", "id": "stale-1"}],
    )
    claimed = claim_next(db_session, lease_owner="crashed-worker", lease_seconds=30)
    assert claimed is not None
    claimed.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=2)
    db_session.commit()

    sender = _FakeWebhookSender()
    runner = _build_runner(poller=_FakePoller(response={"items": []}), webhook_sender=sender)
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert _queue_rows(db_session, seeded["stream_id"])[0].status == QUEUE_STATUS_DELIVERED
    assert len(sender.calls) == 1
    assert summary.get("checkpoint_updated") is True
    assert _checkpoint_value(db_session, seeded["stream_id"]) != before
    stages = _stages(db_session, seeded["stream_id"], str(summary["run_id"]))
    assert "stale_inflight_recovered" in stages
    assert "recovery_success" in stages


def test_fresh_inflight_blocks_fetch_not_stolen(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    before = _checkpoint_value(db_session, seeded["stream_id"])
    row = _seed_pending_item(db_session, seeded)
    claimed = claim_next(db_session, lease_owner="live-owner", lease_seconds=600)
    db_session.commit()

    sender = _FakeWebhookSender()
    poller = _FakePoller(response={"items": [{"id": "nope", "message": "x", "vendor": "v"}]})
    runner = _build_runner(poller=poller, webhook_sender=sender)
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)

    assert sender.calls == []
    assert poller.calls == []
    refreshed = get_queue_item(db_session, int(row.id))
    assert refreshed is not None
    assert refreshed.status == QUEUE_STATUS_IN_FLIGHT
    assert refreshed.lease_owner == "live-owner"
    assert _checkpoint_value(db_session, seeded["stream_id"]) == before
    assert summary.get("outcome") == "durable_queue_recovery"


def test_delivered_not_redelivered_on_restart(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    row = _seed_pending_item(db_session, seeded)
    claimed = claim_next(db_session, lease_owner="w")
    assert claimed is not None
    mark_delivered(db_session, int(claimed.id))
    db_session.commit()

    sender = _FakeWebhookSender()
    runner = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "new-1", "message": "n", "vendor": "v"}]}),
        webhook_sender=sender,
    )
    runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    # Only the new fetch should send; DELIVERED item must not be re-sent.
    assert len(sender.calls) == 1
    assert sender.calls[0]["events"][0].get("event_id") == "new-1" or sender.calls[0]["events"][0].get("id") == "new-1"
    statuses = {r.status for r in _queue_rows(db_session, seeded["stream_id"])}
    assert QUEUE_STATUS_DELIVERED in statuses


def test_exhausted_not_automatically_redelivered(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    row = _seed_pending_item(db_session, seeded)
    claimed = claim_next(db_session, lease_owner="w")
    assert claimed is not None
    mark_exhausted(db_session, int(claimed.id), last_error="max")
    db_session.commit()

    sender = _FakeWebhookSender()
    runner = _build_runner(poller=_FakePoller(response={"items": []}), webhook_sender=sender)
    runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert sender.calls == []
    assert _queue_rows(db_session, seeded["stream_id"])[0].status == QUEUE_STATUS_EXHAUSTED


def test_429_recovery_after_restart(db_session: Session) -> None:
    seeded = _seed_queue_stream(
        db_session,
        failure_policies=["PAUSE_STREAM_ON_FAILURE"],
        dest_configs=[{"retry_count": 3, "retry_backoff_seconds": 0.01}],
    )
    before = _checkpoint_value(db_session, seeded["stream_id"])
    # First run → RETRY_WAIT via 429
    sender1 = _StatusWebhookSender(
        responses=[DestinationSendError("rate limited", http_status=429, retry_after_seconds=0)]
    )
    runner1 = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "r429", "message": "x", "vendor": "v"}]}),
        webhook_sender=sender1,
    )
    runner1.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    row = _queue_rows(db_session, seeded["stream_id"])[0]
    assert row.status == QUEUE_STATUS_RETRY_WAIT
    # Make immediately claimable (simulate available_at elapsed after restart).
    row.available_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()

    sender2 = _FakeWebhookSender()
    runner2 = _build_runner(poller=_FakePoller(response={"items": []}), webhook_sender=sender2)
    summary = runner2.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert _queue_rows(db_session, seeded["stream_id"])[0].status == QUEUE_STATUS_DELIVERED
    assert len(sender2.calls) == 1
    assert summary.get("checkpoint_updated") is True
    assert _checkpoint_value(db_session, seeded["stream_id"]) != before


def test_5xx_recovery_after_restart(db_session: Session) -> None:
    seeded = _seed_queue_stream(
        db_session,
        failure_policies=["PAUSE_STREAM_ON_FAILURE"],
        dest_configs=[{"retry_count": 3, "retry_backoff_seconds": 0.01}],
    )
    before = _checkpoint_value(db_session, seeded["stream_id"])
    sender1 = _StatusWebhookSender(responses=[DestinationSendError("boom", http_status=503)])
    runner1 = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "r5xx", "message": "x", "vendor": "v"}]}),
        webhook_sender=sender1,
    )
    runner1.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    row = _queue_rows(db_session, seeded["stream_id"])[0]
    assert row.status == QUEUE_STATUS_RETRY_WAIT
    row.available_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()

    sender2 = _FakeWebhookSender()
    runner2 = _build_runner(poller=_FakePoller(response={"items": []}), webhook_sender=sender2)
    summary = runner2.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert _queue_rows(db_session, seeded["stream_id"])[0].status == QUEUE_STATUS_DELIVERED
    assert len(sender2.calls) == 1
    assert summary.get("checkpoint_updated") is True
    assert _checkpoint_value(db_session, seeded["stream_id"]) != before


def test_session_restart_persistence_force_expire(db_session: Session, db_engine) -> None:
    seeded = _seed_queue_stream(db_session)
    row = _seed_pending_item(
        db_session,
        seeded,
        events=[{"event_id": "sess-1", "message": "s", "vendor": "v", "id": "sess-1"}],
    )
    claimed = claim_next(db_session, lease_owner="dying", lease_seconds=600)
    assert claimed is not None
    db_session.commit()
    db_session.close()

    Fresh = sessionmaker(bind=db_engine)
    with Fresh() as fresh:
        n = force_expire_inflight_leases(fresh, stream_id=seeded["stream_id"])
        fresh.commit()
        assert n == 1
        loaded = get_queue_item(fresh, int(row.id))
        assert loaded is not None
        assert loaded.status == QUEUE_STATUS_IN_FLIGHT

    with Fresh() as fresh2:
        sender = _FakeWebhookSender()
        runner = _build_runner(poller=_FakePoller(response={"items": []}), webhook_sender=sender)
        runner.run(load_stream_context(fresh2, seeded["stream_id"]), db=fresh2)
        fresh2.expire_all()
        assert get_queue_item(fresh2, int(row.id)).status == QUEUE_STATUS_DELIVERED
        assert len(sender.calls) == 1


def test_failover_regression_on_recovery(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session, failure_policies=["PAUSE_STREAM_ON_FAILURE"])
    primary_id = int(seeded["destination_ids"][0])
    primary = db_session.query(Destination).filter(Destination.id == primary_id).one()
    primary_url = "https://receiver-primary.example.com/events"
    primary.config_json = {**(primary.config_json or {}), "url": primary_url, "retry_count": 2}
    secondary = Destination(
        name=f"fo-sec-{uuid.uuid4().hex[:8]}",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://receiver-backup.example.com/events", "retry_count": 0},
        enabled=True,
    )
    db_session.add(secondary)
    db_session.flush()
    create_failover_route(
        db_session,
        stream_id=seeded["stream_id"],
        primary_destination_id=primary_id,
        secondary_destination_id=int(secondary.id),
        enabled=True,
    )
    db_session.commit()

    row = _seed_pending_item(
        db_session,
        seeded,
        events=[{"event_id": "fo-1", "message": "f", "vendor": "v", "id": "fo-1"}],
    )
    db_session.commit()

    sender = _FailoverWebhookSender(fail_urls={primary_url})
    runner = StreamRunner(
        poller=_FakePoller(response={"items": []}),
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        webhook_sender=sender,
    )
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is True
    assert _queue_rows(db_session, seeded["stream_id"])[0].status == QUEUE_STATUS_DELIVERED
    urls = [c["config"]["url"] for c in sender.calls]
    assert primary_url in urls
    assert "https://receiver-backup.example.com/events" in urls


def test_direct_and_non_webhook_unchanged(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)  # DIRECT
    sender = _FakeWebhookSender()
    runner = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "d1", "message": "x", "vendor": "v"}]}),
        webhook_sender=sender,
    )
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is True
    assert _queue_rows(db_session, seeded["stream_id"]) == []
    assert "queue_recovery_started" not in _stages(db_session, seeded["stream_id"], str(summary["run_id"]))

    seeded_q = _seed_queue_stream(db_session)
    dest = db_session.query(Destination).filter(Destination.id == seeded_q["destination_ids"][0]).one()
    dest.destination_type = "SYSLOG_UDP"
    dest.config_json = {"host": "127.0.0.1", "port": 514}
    db_session.commit()

    class _OkSyslog:
        def __init__(self) -> None:
            self.calls = 0

        def send(self, events, config, formatter_override=None, **kwargs):
            self.calls += 1

    syslog = _OkSyslog()
    runner2 = StreamRunner(
        poller=_FakePoller(response={"items": [{"id": "sys1", "message": "s", "vendor": "v"}]}),
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        webhook_sender=_FakeWebhookSender(),
        syslog_sender=syslog,
    )
    summary2 = runner2.run(load_stream_context(db_session, seeded_q["stream_id"]), db=db_session)
    assert summary2.get("checkpoint_updated") is True
    assert syslog.calls == 1
    assert _queue_rows(db_session, seeded_q["stream_id"]) == []


def test_source_rate_limiter_still_applies_when_queue_empty(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)

    class _Deny:
        def allow(self, *_a, **_k):
            return False

    runner = StreamRunner(
        poller=_FakePoller(response={"items": [{"id": "x", "message": "x", "vendor": "v"}]}),
        source_limiter=_Deny(),
        destination_limiter=_AllowAllLimiter(),
        webhook_sender=_FakeWebhookSender(),
    )
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert summary.get("checkpoint_updated") is False
    stages = _stages(db_session, seeded["stream_id"], str(summary["run_id"]))
    assert "source_rate_limited" in stages


def test_observability_correlation_on_recovery(db_session: Session) -> None:
    seeded = _seed_queue_stream(db_session)
    _seed_pending_item(
        db_session,
        seeded,
        events=[{"event_id": "corr-1", "message": "c", "vendor": "v", "id": "corr-1"}],
    )
    db_session.commit()
    runner = _build_runner(poller=_FakePoller(response={"items": []}), webhook_sender=_FakeWebhookSender())
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    run_id = str(summary["run_id"])
    rows = (
        db_session.query(DeliveryLog)
        .filter(DeliveryLog.stream_id == seeded["stream_id"], DeliveryLog.run_id == run_id)
        .all()
    )
    assert rows
    assert all(r.run_id == run_id for r in rows)
    stages = {r.stage for r in rows}
    assert "queue_recovery_started" in stages
    assert "recovery_success" in stages
    claimed = [r for r in rows if r.stage == "queue_recovery_claimed"]
    assert claimed
    assert claimed[0].route_id == seeded["route_ids"][0]
    assert claimed[0].destination_id == seeded["destination_ids"][0]


@skip_no_wiremock
def test_wiremock_restart_recovery_path(db_session: Session) -> None:
    import httpx
    from tests.e2e_wiremock_helpers import reset_wiremock_journal

    base = DEFAULT_WIREMOCK
    reset_wiremock_journal(base)
    path = f"/ddq-rec/{uuid.uuid4().hex[:10]}"
    mid = str(uuid.uuid4())
    httpx.delete(f"{base.rstrip('/')}/__admin/mappings/{mid}", timeout=5.0)
    r = httpx.post(
        f"{base.rstrip('/')}/__admin/mappings",
        json={
            "id": mid,
            "request": {"method": "POST", "urlPath": path},
            "response": {"status": 200, "body": "OK"},
        },
        timeout=15.0,
    )
    assert r.status_code in (200, 201)

    seeded = _seed_queue_stream(
        db_session,
        dest_configs=[{"url": f"{base.rstrip('/')}{path}", "retry_count": 0, "timeout_seconds": 2}],
    )
    _seed_pending_item(
        db_session,
        seeded,
        events=[{"event_id": "wm-rec", "message": "ok", "vendor": "v", "id": "wm-rec"}],
    )
    db_session.commit()

    from app.delivery.webhook_sender import WebhookSender

    runner = StreamRunner(
        poller=_FakePoller(response={"items": []}),
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        webhook_sender=WebhookSender(),
    )
    summary = runner.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert _queue_rows(db_session, seeded["stream_id"])[0].status == QUEUE_STATUS_DELIVERED
    assert summary.get("checkpoint_updated") is True


def test_toxiproxy_interrupt_then_restart_recovery(db_session: Session) -> None:
    """Toxiproxy dest interrupt → undelivered survives → recover after fault cleared."""

    from tests.e2e_toxiproxy_helpers import (
        PROXY_DEST,
        TOXIPROXY_API_URL,
        TOXIPROXY_DEST_BASE_URL,
        WIREMOCK_BASE_URL,
        ensure_source_and_dest_proxies,
        inject_connection_interrupt,
        remove_fault,
        toxiproxy_reachable,
        wait_proxy_path_ok,
        wait_toxiproxy_ready,
    )
    from tests.e2e_wiremock_helpers import reset_wiremock_journal, wiremock_reachable

    if not (toxiproxy_reachable(TOXIPROXY_API_URL) and wiremock_reachable(WIREMOCK_BASE_URL)):
        pytest.skip("Toxiproxy/WireMock stack not reachable")

    from app.delivery.webhook_sender import WebhookSender

    wait_toxiproxy_ready()
    ensure_source_and_dest_proxies(enabled=True)
    remove_fault(PROXY_DEST)
    wait_proxy_path_ok(TOXIPROXY_DEST_BASE_URL)

    dest_path = f"/ddq-toxi/{uuid.uuid4().hex[:10]}"
    reset_wiremock_journal(WIREMOCK_BASE_URL)
    import httpx

    mid = str(uuid.uuid4())
    httpx.post(
        f"{WIREMOCK_BASE_URL.rstrip('/')}/__admin/mappings",
        json={
            "id": mid,
            "request": {"method": "POST", "urlPath": dest_path},
            "response": {"status": 200, "body": "OK"},
        },
        timeout=15.0,
    )

    seeded = _seed_queue_stream(
        db_session,
        failure_policies=["PAUSE_STREAM_ON_FAILURE"],
        dest_configs=[
            {
                "url": f"{TOXIPROXY_DEST_BASE_URL.rstrip('/')}{dest_path}",
                "retry_count": 2,
                "retry_backoff_seconds": 0.01,
                "timeout_seconds": 2,
            }
        ],
    )
    _seed_pending_item(
        db_session,
        seeded,
        events=[{"event_id": "toxi-1", "message": "t", "vendor": "v", "id": "toxi-1"}],
    )
    db_session.commit()
    before = _checkpoint_value(db_session, seeded["stream_id"])

    inject_connection_interrupt(PROXY_DEST, bytes_limit=1)
    try:
        runner_fail = StreamRunner(
            poller=_FakePoller(response={"items": []}),
            source_limiter=_AllowAllLimiter(),
            destination_limiter=_AllowAllLimiter(),
            webhook_sender=WebhookSender(),
        )
        runner_fail.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
        row = _queue_rows(db_session, seeded["stream_id"])[0]
        assert row.status in {QUEUE_STATUS_RETRY_WAIT, QUEUE_STATUS_IN_FLIGHT, QUEUE_STATUS_EXHAUSTED}
        # Simulate restart window: ensure reclaimable retry/pending state.
        if row.status == QUEUE_STATUS_IN_FLIGHT:
            row.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        if row.status == QUEUE_STATUS_RETRY_WAIT:
            row.available_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        if row.status == QUEUE_STATUS_EXHAUSTED:
            # Soften to RETRY_WAIT so recovery path is exercised after fault clear.
            row.status = QUEUE_STATUS_RETRY_WAIT
            row.available_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            row.attempt_count = 1
        db_session.commit()
    finally:
        remove_fault(PROXY_DEST)
        wait_proxy_path_ok(TOXIPROXY_DEST_BASE_URL)

    runner_ok = StreamRunner(
        poller=_FakePoller(response={"items": []}),
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        webhook_sender=WebhookSender(),
    )
    summary = runner_ok.run(load_stream_context(db_session, seeded["stream_id"]), db=db_session)
    assert _queue_rows(db_session, seeded["stream_id"])[0].status == QUEUE_STATUS_DELIVERED
    assert summary.get("checkpoint_updated") is True
    assert _checkpoint_value(db_session, seeded["stream_id"]) != before
    assert "recovery_success" in _stages(db_session, seeded["stream_id"], str(summary["run_id"]))
