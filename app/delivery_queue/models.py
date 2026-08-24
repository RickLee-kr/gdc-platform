"""StreamDeliveryQueueItem — Route + Destination delivery batch persistence.

Architecture authority:
``docs/architecture/durable-delivery-queue-audit-design.md`` (§Q5–Q7).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.replay.models import (
    DELIVERY_KIND_BASE_ROUTE,
    DELIVERY_KIND_DYNAMIC_ROUTE,
    DELIVERY_KIND_FAILOVER_SECONDARY,
    DELIVERY_KINDS,
)

# Re-export delivery kinds so callers can import from delivery_queue.
__all__ = [
    "DELIVERY_KIND_BASE_ROUTE",
    "DELIVERY_KIND_DYNAMIC_ROUTE",
    "DELIVERY_KIND_FAILOVER_SECONDARY",
    "DELIVERY_KINDS",
    "QUEUE_STATUS_PENDING",
    "QUEUE_STATUS_IN_FLIGHT",
    "QUEUE_STATUS_RETRY_WAIT",
    "QUEUE_STATUS_DELIVERED",
    "QUEUE_STATUS_EXHAUSTED",
    "QUEUE_STATUSES",
    "QUEUE_CLAIMABLE_STATUSES",
    "QUEUE_TERMINAL_STATUSES",
    "ALLOWED_QUEUE_TRANSITIONS",
    "StreamDeliveryQueueItem",
]

QUEUE_STATUS_PENDING = "PENDING"
QUEUE_STATUS_IN_FLIGHT = "IN_FLIGHT"
QUEUE_STATUS_RETRY_WAIT = "RETRY_WAIT"
QUEUE_STATUS_DELIVERED = "DELIVERED"
QUEUE_STATUS_EXHAUSTED = "EXHAUSTED"

QUEUE_STATUSES = frozenset(
    {
        QUEUE_STATUS_PENDING,
        QUEUE_STATUS_IN_FLIGHT,
        QUEUE_STATUS_RETRY_WAIT,
        QUEUE_STATUS_DELIVERED,
        QUEUE_STATUS_EXHAUSTED,
    }
)

QUEUE_CLAIMABLE_STATUSES = frozenset({QUEUE_STATUS_PENDING, QUEUE_STATUS_RETRY_WAIT})

QUEUE_TERMINAL_STATUSES = frozenset({QUEUE_STATUS_DELIVERED, QUEUE_STATUS_EXHAUSTED})

# Allowed worker/repository transitions. Stale IN_FLIGHT reclaim is handled
# atomically inside ``claim_next`` (IN_FLIGHT → IN_FLIGHT with a new lease).
ALLOWED_QUEUE_TRANSITIONS: dict[str, frozenset[str]] = {
    QUEUE_STATUS_PENDING: frozenset({QUEUE_STATUS_IN_FLIGHT}),
    QUEUE_STATUS_IN_FLIGHT: frozenset(
        {
            QUEUE_STATUS_DELIVERED,
            QUEUE_STATUS_RETRY_WAIT,
            QUEUE_STATUS_EXHAUSTED,
        }
    ),
    QUEUE_STATUS_RETRY_WAIT: frozenset({QUEUE_STATUS_IN_FLIGHT}),
    QUEUE_STATUS_DELIVERED: frozenset(),
    QUEUE_STATUS_EXHAUSTED: frozenset(),
}


class StreamDeliveryQueueItem(Base):
    """Durable outbox row for one Route → Destination delivery batch."""

    __tablename__ = "stream_delivery_queue_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    stream_id: Mapped[int] = mapped_column(ForeignKey("streams.id", ondelete="CASCADE"), nullable=False)
    route_id: Mapped[int] = mapped_column(ForeignKey("routes.id", ondelete="RESTRICT"), nullable=False)
    destination_id: Mapped[int] = mapped_column(
        ForeignKey("destinations.id", ondelete="RESTRICT"), nullable=False
    )
    batch_id: Mapped[str] = mapped_column(String(64), nullable=False)
    delivery_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    payload_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=QUEUE_STATUS_PENDING)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    lease_owner: Mapped[str | None] = mapped_column(String(128), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
