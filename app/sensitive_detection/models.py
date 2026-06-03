"""Persistence for per-Stream sensitive field findings."""

from __future__ import annotations

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow

SENSITIVITY_CLASS_SECRET = "secret"
SENSITIVITY_CLASS_PII = "pii"
SENSITIVITY_CLASS_SECURITY_METADATA = "security_metadata"

DETECTION_METHOD_FIELD_NAME = "field_name"
DETECTION_METHOD_PATTERN = "pattern"

FINDING_STATUS_OPEN = "open"
FINDING_STATUS_ACKNOWLEDGED = "acknowledged"
FINDING_STATUS_RESOLVED = "resolved"

RESOLUTION_FALSE_POSITIVE = "false_positive"
RESOLUTION_ACCEPTED_RISK = "accepted_risk"
RESOLUTION_REMEDIATED_MAPPING = "remediated_mapping"
RESOLUTION_PROTECTION_APPLIED = "protection_applied"
RESOLUTION_SUPERSEDED = "superseded"


class StreamSensitiveFinding(Base):
    """Open or historical sensitive-field signals for a Stream (enriched path namespace)."""

    __tablename__ = "stream_sensitive_findings"
    __table_args__ = (
        UniqueConstraint(
            "stream_id",
            "field_path",
            "sensitivity_class",
            name="uq_stream_sensitive_findings_stream_path_class",
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
    sensitivity_class: Mapped[str] = mapped_column(String(32), nullable=False)
    detection_method: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=FINDING_STATUS_OPEN)
    confirm_run_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    first_detected_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    last_confirmed_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    finding_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    related_drift_finding_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("stream_schema_field_drifts.id", ondelete="SET NULL"),
        nullable=True,
    )
    acknowledged_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    resolved_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    operator_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolution: Mapped[str | None] = mapped_column(String(32), nullable=True)
