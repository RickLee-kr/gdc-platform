"""Repository foundation for StreamDeliveryQueueItem claim/lease APIs.

Phase 1 only: no Destination network I/O, no runtime wiring, no checkpoint changes.
Uses PostgreSQL ``SELECT … FOR UPDATE SKIP LOCKED`` for concurrent claim safety.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import Select, select
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


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_transition(row: StreamDeliveryQueueItem, target: str) -> None:
    allowed = ALLOWED_QUEUE_TRANSITIONS.get(str(row.status), frozenset())
    if target not in allowed:
        raise QueueItemStateError(item_id=int(row.id), current=str(row.status), target=target)


def get_queue_item(db: Session, item_id: int) -> StreamDeliveryQueueItem | None:
    return db.get(StreamDeliveryQueueItem, int(item_id))


def list_claimable_items(
    db: Session,
    *,
    stream_id: int | None = None,
    route_id: int | None = None,
    limit: int = 50,
    now: datetime | None = None,
) -> list[StreamDeliveryQueueItem]:
    """Query PENDING / RETRY_WAIT items that are available for claim (no lock)."""

    ts = now or _utcnow()
    lim = max(1, min(int(limit), 500))
    stmt: Select[tuple[StreamDeliveryQueueItem]] = (
        select(StreamDeliveryQueueItem)
        .where(
            StreamDeliveryQueueItem.status.in_(tuple(QUEUE_CLAIMABLE_STATUSES)),
            StreamDeliveryQueueItem.available_at <= ts,
        )
        .order_by(StreamDeliveryQueueItem.available_at.asc(), StreamDeliveryQueueItem.id.asc())
        .limit(lim)
    )
    if stream_id is not None:
        stmt = stmt.where(StreamDeliveryQueueItem.stream_id == int(stream_id))
    if route_id is not None:
        stmt = stmt.where(StreamDeliveryQueueItem.route_id == int(route_id))
    return list(db.scalars(stmt).all())


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
    lease_seconds: int = DEFAULT_LEASE_SECONDS,
    now: datetime | None = None,
) -> StreamDeliveryQueueItem | None:
    """Atomically claim one available PENDING/RETRY_WAIT item → IN_FLIGHT.

    Uses ``FOR UPDATE SKIP LOCKED`` so concurrent workers cannot claim the same row.
    """

    owner = str(lease_owner or "").strip()
    if not owner:
        raise ValueError("lease_owner is required")
    ts = now or _utcnow()
    ttl = max(1, int(lease_seconds))

    stmt: Select[tuple[StreamDeliveryQueueItem]] = (
        select(StreamDeliveryQueueItem)
        .where(
            StreamDeliveryQueueItem.status.in_(tuple(QUEUE_CLAIMABLE_STATUSES)),
            StreamDeliveryQueueItem.available_at <= ts,
        )
        .order_by(StreamDeliveryQueueItem.available_at.asc(), StreamDeliveryQueueItem.id.asc())
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if stream_id is not None:
        stmt = stmt.where(StreamDeliveryQueueItem.stream_id == int(stream_id))
    if route_id is not None:
        stmt = stmt.where(StreamDeliveryQueueItem.route_id == int(route_id))

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


def claim_by_id(
    db: Session,
    item_id: int,
    *,
    lease_owner: str,
    lease_seconds: int = DEFAULT_LEASE_SECONDS,
    now: datetime | None = None,
) -> StreamDeliveryQueueItem | None:
    """Claim a specific PENDING/RETRY_WAIT item → IN_FLIGHT (SKIP LOCKED)."""

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
    "QueueItemNotFoundError",
    "QueueItemStateError",
    "QueuePayloadSecretError",
    "claim_by_id",
    "claim_next",
    "enqueue",
    "get_queue_item",
    "list_claimable_items",
    "mark_delivered",
    "mark_exhausted",
    "mark_retry_wait",
    "retarget_failover",
]
