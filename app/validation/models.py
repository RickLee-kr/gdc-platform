"""SQLAlchemy models for continuous validation definitions and run history."""

from __future__ import annotations

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, utcnow


class ContinuousValidation(Base):
    """Operator-defined synthetic validation job targeting an existing stream."""

    __tablename__ = "continuous_validations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    validation_type: Mapped[str] = mapped_column(String(32), nullable=False)
    target_stream_id: Mapped[int | None] = mapped_column(ForeignKey("streams.id", ondelete="SET NULL"), nullable=True)
    template_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    schedule_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=300)
    expect_checkpoint_advance: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_run_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_status: Mapped[str] = mapped_column(String(32), nullable=False, default="HEALTHY")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_success_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_failing_started_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_perf_snapshot_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    runs: Mapped[list["ValidationRun"]] = relationship(
        "ValidationRun", back_populates="validation", cascade="all, delete-orphan"
    )


class ValidationRun(Base):
    """One validation execution stage or aggregate row (separate from delivery_logs)."""

    __tablename__ = "validation_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    validation_id: Mapped[int] = mapped_column(
        ForeignKey("continuous_validations.id", ondelete="CASCADE"), nullable=False
    )
    stream_id: Mapped[int | None] = mapped_column(ForeignKey("streams.id", ondelete="SET NULL"), nullable=True)
    run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    validation_stage: Mapped[str] = mapped_column(String(64), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    validation: Mapped["ContinuousValidation"] = relationship("ContinuousValidation", back_populates="runs")


class ValidationAlert(Base):
    """Operational alert raised from continuous validation outcomes (additive monitoring)."""

    __tablename__ = "validation_alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    validation_id: Mapped[int] = mapped_column(
        ForeignKey("continuous_validations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    validation_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("validation_runs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    alert_type: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="OPEN", index=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    triggered_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    acknowledged_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class ValidationRecoveryEvent(Base):
    """Synthetic recovery timeline entries when validation returns to a healthy path."""

    __tablename__ = "validation_recovery_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    validation_id: Mapped[int] = mapped_column(
        ForeignKey("continuous_validations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    validation_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("validation_runs.id", ondelete="SET NULL"), nullable=True
    )
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
