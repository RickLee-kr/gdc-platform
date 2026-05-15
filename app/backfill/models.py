"""SQLAlchemy models: BackfillJob, BackfillProgressEvent."""

from __future__ import annotations

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, utcnow


class BackfillJob(Base):
    """Operator-scoped backfill intent; does not own StreamRunner transactions."""

    __tablename__ = "backfill_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    stream_id: Mapped[int] = mapped_column(ForeignKey("streams.id", ondelete="CASCADE"), nullable=False, index=True)
    source_type: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING", index=True)
    backfill_mode: Mapped[str] = mapped_column(String(64), nullable=False)
    requested_by: Mapped[str] = mapped_column(String(256), nullable=False, default="unknown")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    started_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source_config_snapshot_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    checkpoint_snapshot_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    runtime_options_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    progress_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    error_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    delivery_summary_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    stream = relationship("Stream", backref="backfill_jobs")
    progress_events = relationship(
        "BackfillProgressEvent",
        back_populates="job",
        cascade="all, delete-orphan",
    )


class BackfillProgressEvent(Base):
    """Append-only progress / audit events for a backfill job (distinct from runtime delivery_logs)."""

    __tablename__ = "backfill_progress_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    backfill_job_id: Mapped[int] = mapped_column(
        ForeignKey("backfill_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    stream_id: Mapped[int] = mapped_column(ForeignKey("streams.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    level: Mapped[str] = mapped_column(String(16), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    progress_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)

    job = relationship("BackfillJob", back_populates="progress_events")
