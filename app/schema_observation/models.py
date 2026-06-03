"""Persistence for per-Stream observed schema and field drift findings."""

from __future__ import annotations

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow

DRIFT_CATEGORY_FIELD_ADDED = "field_added"
DRIFT_CATEGORY_FIELD_REMOVED = "field_removed"
DRIFT_STATUS_OPEN = "open"


class StreamObservedSchema(Base):
    """Runtime-accumulated field paths and types for a Stream."""

    __tablename__ = "stream_observed_schemas"

    stream_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("streams.id", ondelete="CASCADE"),
        primary_key=True,
    )
    paths_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    baseline_paths_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    baseline_established_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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


class StreamSchemaFieldDrift(Base):
    """Open or historical field-level schema drift signals for a Stream."""

    __tablename__ = "stream_schema_field_drifts"
    __table_args__ = (
        UniqueConstraint(
            "stream_id",
            "field_path",
            "category",
            name="uq_stream_schema_field_drifts_stream_path_category",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    stream_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("streams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    field_path: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=DRIFT_STATUS_OPEN)
    first_detected_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    last_confirmed_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
