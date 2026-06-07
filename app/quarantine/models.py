"""Stream-scoped quarantine events (protected payload snapshots only)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

QUARANTINE_STATUS_QUARANTINED = "quarantined"
QUARANTINE_STATUS_RELEASED = "released"
QUARANTINE_STATUS_DISCARDED = "discarded"

QUARANTINE_STATUSES = frozenset(
    {
        QUARANTINE_STATUS_QUARANTINED,
        QUARANTINE_STATUS_RELEASED,
        QUARANTINE_STATUS_DISCARDED,
    }
)

QUARANTINE_TERMINAL_STATUSES = frozenset({QUARANTINE_STATUS_RELEASED, QUARANTINE_STATUS_DISCARDED})

QUARANTINE_SOURCE_MANUAL = "manual"
QUARANTINE_SOURCE_POLICY = "policy"

QUARANTINE_SOURCES = frozenset({QUARANTINE_SOURCE_MANUAL, QUARANTINE_SOURCE_POLICY})


class StreamQuarantineEvent(Base):
    __tablename__ = "stream_quarantine_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    stream_id: Mapped[int] = mapped_column(ForeignKey("streams.id", ondelete="CASCADE"), nullable=False)
    quarantine_reason: Mapped[str] = mapped_column(String(256), nullable=False)
    quarantine_source: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=QUARANTINE_STATUS_QUARANTINED)
    protected_payload_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    metadata_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    released_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
