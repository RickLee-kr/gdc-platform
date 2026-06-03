"""Persistence for per-Stream observed schema (Milestone 1)."""

from __future__ import annotations

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow


class StreamObservedSchema(Base):
    """Runtime-accumulated field paths and types for a Stream (observation only)."""

    __tablename__ = "stream_observed_schemas"

    stream_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("streams.id", ondelete="CASCADE"),
        primary_key=True,
    )
    paths_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    total_events_observed: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    observation_run_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_observation_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )
