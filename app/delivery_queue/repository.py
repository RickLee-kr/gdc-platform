"""Repository foundation for StreamDeliveryQueueItem claim/lease APIs.

Uses PostgreSQL ``SELECT … FOR UPDATE SKIP LOCKED`` for concurrent claim safety.
Phase 3: claim also reclaims stale ``IN_FLIGHT`` rows whose lease has expired.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import Select, and_, func, or_, select, update
from sqlalchemy.orm import Session

from app.delivery_queue.models import (
    ALLOWED_QUEUE_TRANSITIONS,
    DELIVERY_KINDS,
    QUEUE_CLAIMABLE_STATUSES,
    QUEUE_STATUS_DELIVERED,
    QUEUE_STATUS_EXHAUSTED,
    QUEUE_STATUS_IN_FLIGHT,
    QUEUE_STATUS_PENDING,
    QUEUE_STATUS_RETRY_WAIT,
    StreamDeliveryQueueItem,
)
from app.delivery_queue.payload import (
    QueuePayloadSecretError,
    normalize_queue_payload,
    truncate_last_error,
)

DEFAULT_LEASE_SECONDS = 60

_NON_TERMINAL_STATUSES = frozenset(
    {
        QUEUE_STATUS_PENDING,
        QUEUE_STATUS_IN_FLIGHT,
        QUEUE_STATUS_RETRY_WAIT,
    }
)


class QueueItemNotFoundError(Exception):
    def __init__(self, item_id: int) -> None:
        self.item_id = item_id
        super().__init__(f"delivery queue item not found: {item_id}")


class QueueItemStateError(Exception):
    def __init__(self, *, item_id: int, current: str, target: str) -> None:
        self.item_id = item_id
        self.current = current
        self.target = target
        super().__init__(
            f"invalid delivery queue transition for item {item_id}: {current} → {target}"
        )


@dataclass(frozen=True, slots=True)
class ClaimedQueueItem:
    """Result of an atomic claim (fresh PENDING/RETRY_WAIT or stale IN_FLIGHT reclaim)."""

    item: StreamDeliveryQueueItem
    recovered_stale_inflight: bool


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_transition(row: StreamDeliveryQueueItem, target: str) -> None:
    allowed = ALLOWED_QUEUE_TRANSITIONS.get(str(row.status), frozenset())
    if target not in allowed:
        raise QueueItemStateError(item_id=int(row.id), current=str(row.status), target=target)


def _claimable_where(ts: datetime):
    """PENDING/RETRY_WAIT ready now, or IN_FLIGHT with expired/missing lease."""

    ready_pending = and_(
        StreamDeliveryQueueItem.status.in_(tuple(QUEUE_CLAIMABLE_STATUSES)),
        StreamDeliveryQueueItem.available_at <= ts,
    )
    stale_inflight = and_(
        StreamDeliveryQueueItem.status == QUEUE_STATUS_IN_FLIGHT,
        or_(
            StreamDeliveryQueueItem.lease_expires_at.is_(None),
            StreamDeliveryQueueItem.lease_expires_at <= ts,
        ),
    )
    return or_(ready_pending, stale_inflight)


def get_queue_item(db: Session, item_id: int) -> StreamDeliveryQueueItem | None:
    return db.get(StreamDeliveryQueueItem, int(item_id))


def list_claimable_items(
    db: Session,
    *,
    stream_id: int | None = None,
    route_id: int | None = None,
    destination_id: int | None = None,
    limit: int = 50,
    now: datetime | None = None,
) -> list[StreamDeliveryQueueItem]:
    """Query claimable PENDING / RETRY_WAIT / stale IN_FLIGHT items (no lock)."""

    ts = now or _utcnow()
    lim = max(1, min(int(limit), 500))
    stmt: Select[tuple[StreamDeliveryQueueItem]] = (
        select(StreamDeliveryQueueItem)
        .where(_claimable_where(ts))
        .order_by(StreamDeliveryQueueItem.available_at.asc(), StreamDeliveryQueueItem.id.asc())
        .limit(lim)
    )
    if stream_id is not None:
        stmt = stmt.where(StreamDeliveryQueueItem.stream_id == int(stream_id))
    if route_id is not None:
        stmt = stmt.where(StreamDeliveryQueueItem.route_id == int(route_id))
    if destination_id is not None:
        stmt = stmt.where(StreamDeliveryQueueItem.destination_id == int(destination_id))
    return list(db.scalars(stmt).all())


def count_non_terminal_items(
    db: Session,
    *,
    stream_id: int,
) -> int:
    """Count PENDING / IN_FLIGHT / RETRY_WAIT items for a stream."""

    stmt = (
        select(func.count())
        .select_from(StreamDeliveryQueueItem)
        .where(
            StreamDeliveryQueueItem.stream_id == int(stream_id),
            StreamDeliveryQueueItem.status.in_(tuple(_NON_TERMINAL_STATUSES)),
        )
    )
    return int(db.scalar(stmt) or 0)


def get_queue_operational_state(
    db: Session,
    *,
    stream_id: int,
    destination_id: int | None = None,
    now: datetime | None = None,
):
    """Compute durable-queue operational depths for backpressure / ops.

    ``pending_depth`` / ``retry_wait_depth`` / ``inflight_depth`` are disjoint.
    ``exhausted_depth`` is reported separately and must not feed pressure gates.
    Optional ``destination_id`` scopes the same metrics to one destination.
    """

    from app.delivery_queue.backpressure import QueueOperationalState

    ts = now or _utcnow()
    sid = int(stream_id)

    def _count(status: str) -> int:
        stmt = (
            select(func.count())
            .select_from(StreamDeliveryQueueItem)
            .where(
                StreamDeliveryQueueItem.stream_id == sid,
                StreamDeliveryQueueItem.status == status,
            )
        )
        if destination_id is not None:
            stmt = stmt.where(StreamDeliveryQueueItem.destination_id == int(destination_id))
        return int(db.scalar(stmt) or 0)

    pending = _count(QUEUE_STATUS_PENDING)
    retry_wait = _count(QUEUE_STATUS_RETRY_WAIT)
    inflight = _count(QUEUE_STATUS_IN_FLIGHT)
    exhausted = _count(QUEUE_STATUS_EXHAUSTED)

    oldest_stmt = select(func.min(StreamDeliveryQueueItem.created_at)).where(
        StreamDeliveryQueueItem.stream_id == sid,
        StreamDeliveryQueueItem.status.in_(tuple(_NON_TERMINAL_STATUSES)),
    )
    if destination_id is not None:
        oldest_stmt = oldest_stmt.where(
            StreamDeliveryQueueItem.destination_id == int(destination_id)
        )
    oldest_created = db.scalar(oldest_stmt)
    oldest_age: float | None = None
    if oldest_created is not None:
        created = oldest_created
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        oldest_age = max(0.0, (ts - created).total_seconds())

    return QueueOperationalState(
        stream_id=sid,
        pending_depth=pending,
        retry_wait_depth=retry_wait,
        inflight_depth=inflight,
        exhausted_depth=exhausted,
        oldest_pending_age_seconds=oldest_age,
        destination_id=int(destination_id) if destination_id is not None else None,
    )


def try_reserve_queue_slot(
    db: Session,
    *,
    stream_id: int,
    max_pending_items: int,
) -> bool:
    """Return True when an enqueue may proceed under ``max_pending_items``.

    Takes a transaction-scoped advisory lock on ``stream_id`` so concurrent
    workers serialize the capacity check + subsequent insert. EXHAUSTED rows
    are not counted.
    """

    lim = max(1, int(max_pending_items))
    sid = int(stream_id)
    # Namespace 805_001 = delivery-queue backpressure (avoid colliding with other locks).
    db.execute(select(func.pg_advisory_xact_lock(805001, sid)))
    stmt = (
        select(func.count())
        .select_from(StreamDeliveryQueueItem)
        .where(
            StreamDeliveryQueueItem.stream_id == sid,
            StreamDeliveryQueueItem.status.in_(tuple(_NON_TERMINAL_STATUSES)),
        )
    )
    depth = int(db.scalar(stmt) or 0)
    return depth < lim


def count_open_items_for_batch(
    db: Session,
    *,
    batch_id: str,
    stream_id: int | None = None,
) -> int:
    """Count non-terminal items sharing ``batch_id`` (checkpoint eligibility)."""

    stmt = (
        select(func.count())
        .select_from(StreamDeliveryQueueItem)
        .where(
            StreamDeliveryQueueItem.batch_id == str(batch_id),
            StreamDeliveryQueueItem.status.in_(tuple(_NON_TERMINAL_STATUSES)),
        )
    )
    if stream_id is not None:
        stmt = stmt.where(StreamDeliveryQueueItem.stream_id == int(stream_id))
    return int(db.scalar(stmt) or 0)


def force_expire_inflight_leases(
    db: Session,
    *,
    stream_id: int,
    now: datetime | None = None,
) -> int:
    """Make IN_FLIGHT leases immediately reclaimable (graceful shutdown safety)."""

    ts = now or _utcnow()
    result = db.execute(
        update(StreamDeliveryQueueItem)
        .where(
            StreamDeliveryQueueItem.stream_id == int(stream_id),
            StreamDeliveryQueueItem.status == QUEUE_STATUS_IN_FLIGHT,
        )
        .values(lease_expires_at=ts, updated_at=ts)
    )
    db.flush()
    return int(result.rowcount or 0)

def enqueue(
    db: Session,
    *,
    stream_id: int,
    route_id: int,
    destination_id: int,
    batch_id: str,
    delivery_kind: str,
    payload: list[dict[str, Any]] | dict[str, Any],
    available_at: datetime | None = None,
) -> StreamDeliveryQueueItem:
    """Insert a PENDING queue item. Caller commits the short TX."""

    kind = str(delivery_kind or "").strip()
    if kind not in DELIVERY_KINDS:
        raise ValueError(f"invalid delivery_kind: {delivery_kind!r}")
    batch = str(batch_id or "").strip()
    if not batch:
        raise ValueError("batch_id is required")

    payload_json = normalize_queue_payload(payload)
    now = _utcnow()
    row = StreamDeliveryQueueItem(
        stream_id=int(stream_id),
        route_id=int(route_id),
        destination_id=int(destination_id),
        batch_id=batch,
        delivery_kind=kind,
        payload_json=payload_json,
        status=QUEUE_STATUS_PENDING,
        attempt_count=0,
        available_at=available_at or now,
        lease_owner=None,
        lease_expires_at=None,
        created_at=now,
        updated_at=now,
        delivered_at=None,
        last_error=None,
    )
    db.add(row)
    db.flush()
    return row


def claim_next(
    db: Session,
    *,
    lease_owner: str,
    stream_id: int | None = None,
    route_id: int | None = None,
    destination_id: int | None = None,
    lease_seconds: int = DEFAULT_LEASE_SECONDS,
    now: datetime | None = None,
) -> StreamDeliveryQueueItem | None:
    """Atomically claim one available item → IN_FLIGHT (SKIP LOCKED).

    Claimable set: PENDING / RETRY_WAIT with ``available_at <= now``, plus stale
    ``IN_FLIGHT`` rows whose lease has expired. Fresh IN_FLIGHT leases are never stolen.
    """

    claimed = claim_next_detailed(
        db,
        lease_owner=lease_owner,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        lease_seconds=lease_seconds,
        now=now,
    )
    return claimed.item if claimed is not None else None


def claim_next_detailed(
    db: Session,
    *,
    lease_owner: str,
    stream_id: int | None = None,
    route_id: int | None = None,
    destination_id: int | None = None,
    lease_seconds: int = DEFAULT_LEASE_SECONDS,
    now: datetime | None = None,
) -> ClaimedQueueItem | None:
    """Like ``claim_next`` but reports whether the row was a stale IN_FLIGHT reclaim."""

    owner = str(lease_owner or "").strip()
    if not owner:
        raise ValueError("lease_owner is required")
    ts = now or _utcnow()
    ttl = max(1, int(lease_seconds))

    stmt: Select[tuple[StreamDeliveryQueueItem]] = (
        select(StreamDeliveryQueueItem)
        .where(_claimable_where(ts))
        .order_by(StreamDeliveryQueueItem.available_at.asc(), StreamDeliveryQueueItem.id.asc())
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if stream_id is not None:
        stmt = stmt.where(StreamDeliveryQueueItem.stream_id == int(stream_id))
    if route_id is not None:
        stmt = stmt.where(StreamDeliveryQueueItem.route_id == int(route_id))
    if destination_id is not None:
        stmt = stmt.where(StreamDeliveryQueueItem.destination_id == int(destination_id))

    row = db.scalars(stmt).first()
    if row is None:
        return None

    recovered_stale = str(row.status) == QUEUE_STATUS_IN_FLIGHT
    if not recovered_stale:
        _ensure_transition(row, QUEUE_STATUS_IN_FLIGHT)
    row.status = QUEUE_STATUS_IN_FLIGHT
    row.attempt_count = int(row.attempt_count or 0) + 1
    row.lease_owner = owner
    row.lease_expires_at = ts + timedelta(seconds=ttl)
    row.updated_at = ts
    db.flush()
    return ClaimedQueueItem(item=row, recovered_stale_inflight=recovered_stale)


def claim_by_id(
    db: Session,
    item_id: int,
    *,
    lease_owner: str,
    lease_seconds: int = DEFAULT_LEASE_SECONDS,
    now: datetime | None = None,
) -> StreamDeliveryQueueItem | None:
    """Claim a specific PENDING/RETRY_WAIT item → IN_FLIGHT (SKIP LOCKED).

    Does not reclaim stale IN_FLIGHT by id — use ``claim_next`` / recovery for that.
    """

    owner = str(lease_owner or "").strip()
    if not owner:
        raise ValueError("lease_owner is required")
    ts = now or _utcnow()
    ttl = max(1, int(lease_seconds))

    stmt: Select[tuple[StreamDeliveryQueueItem]] = (
        select(StreamDeliveryQueueItem)
        .where(
            StreamDeliveryQueueItem.id == int(item_id),
            StreamDeliveryQueueItem.status.in_(tuple(QUEUE_CLAIMABLE_STATUSES)),
            StreamDeliveryQueueItem.available_at <= ts,
        )
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    row = db.scalars(stmt).first()
    if row is None:
        return None

    _ensure_transition(row, QUEUE_STATUS_IN_FLIGHT)
    row.status = QUEUE_STATUS_IN_FLIGHT
    row.attempt_count = int(row.attempt_count or 0) + 1
    row.lease_owner = owner
    row.lease_expires_at = ts + timedelta(seconds=ttl)
    row.updated_at = ts
    db.flush()
    return row


def retarget_failover(
    db: Session,
    item_id: int,
    *,
    secondary_destination_id: int,
    now: datetime | None = None,
) -> StreamDeliveryQueueItem:
    """Update-in-place primary → failover secondary (audit design §Q12).

    Keeps the same queue row identity; only destination_id / delivery_kind change.
    Item must be IN_FLIGHT (claimed for the primary attempt that just failed).
    """

    from app.delivery_queue.models import DELIVERY_KIND_FAILOVER_SECONDARY

    row = get_queue_item(db, item_id)
    if row is None:
        raise QueueItemNotFoundError(item_id)
    if str(row.status) != QUEUE_STATUS_IN_FLIGHT:
        raise QueueItemStateError(
            item_id=int(item_id),
            current=str(row.status),
            target=QUEUE_STATUS_IN_FLIGHT,
        )
    ts = now or _utcnow()
    row.destination_id = int(secondary_destination_id)
    row.delivery_kind = DELIVERY_KIND_FAILOVER_SECONDARY
    row.attempt_count = int(row.attempt_count or 0) + 1
    row.updated_at = ts
    row.last_error = truncate_last_error(row.last_error)
    db.flush()
    return row


def mark_delivered(
    db: Session,
    item_id: int,
    *,
    now: datetime | None = None,
) -> StreamDeliveryQueueItem:
    row = get_queue_item(db, item_id)
    if row is None:
        raise QueueItemNotFoundError(item_id)
    _ensure_transition(row, QUEUE_STATUS_DELIVERED)
    ts = now or _utcnow()
    row.status = QUEUE_STATUS_DELIVERED
    row.delivered_at = ts
    row.lease_owner = None
    row.lease_expires_at = None
    row.updated_at = ts
    db.flush()
    return row


def mark_retry_wait(
    db: Session,
    item_id: int,
    *,
    available_at: datetime,
    last_error: str | None = None,
    now: datetime | None = None,
) -> StreamDeliveryQueueItem:
    row = get_queue_item(db, item_id)
    if row is None:
        raise QueueItemNotFoundError(item_id)
    _ensure_transition(row, QUEUE_STATUS_RETRY_WAIT)
    ts = now or _utcnow()
    row.status = QUEUE_STATUS_RETRY_WAIT
    row.available_at = available_at
    row.last_error = truncate_last_error(last_error)
    row.lease_owner = None
    row.lease_expires_at = None
    row.updated_at = ts
    db.flush()
    return row


def mark_exhausted(
    db: Session,
    item_id: int,
    *,
    last_error: str | None = None,
    now: datetime | None = None,
) -> StreamDeliveryQueueItem:
    row = get_queue_item(db, item_id)
    if row is None:
        raise QueueItemNotFoundError(item_id)
    _ensure_transition(row, QUEUE_STATUS_EXHAUSTED)
    ts = now or _utcnow()
    row.status = QUEUE_STATUS_EXHAUSTED
    row.last_error = truncate_last_error(last_error)
    row.lease_owner = None
    row.lease_expires_at = None
    row.updated_at = ts
    db.flush()
    return row


# Re-export for callers that only import repository.
__all__ = [
    "DEFAULT_LEASE_SECONDS",
    "ClaimedQueueItem",
    "QueueItemNotFoundError",
    "QueueItemStateError",
    "QueuePayloadSecretError",
    "claim_by_id",
    "claim_next",
    "claim_next_detailed",
    "count_non_terminal_items",
    "count_open_items_for_batch",
    "enqueue",
    "force_expire_inflight_leases",
    "get_queue_item",
    "get_queue_operational_state",
    "list_claimable_items",
    "mark_delivered",
    "mark_exhausted",
    "mark_retry_wait",
    "retarget_failover",
    "try_reserve_queue_slot",
]
