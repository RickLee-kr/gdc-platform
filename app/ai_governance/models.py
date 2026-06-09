"""AI policy violations and governance workflow (M24)."""

from __future__ import annotations

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow

VIOLATION_STATUS_OPEN = "OPEN"
VIOLATION_STATUS_ACKNOWLEDGED = "ACKNOWLEDGED"
VIOLATION_STATUS_RESOLVED = "RESOLVED"

VIOLATION_STATUSES = (
    VIOLATION_STATUS_OPEN,
    VIOLATION_STATUS_ACKNOWLEDGED,
    VIOLATION_STATUS_RESOLVED,
)

SEVERITY_HIGH = "HIGH"
SEVERITY_MEDIUM = "MEDIUM"
SEVERITY_LOW = "LOW"

SEVERITY_LEVELS = (SEVERITY_HIGH, SEVERITY_MEDIUM, SEVERITY_LOW)


class AiPolicyViolation(Base):
    """Operator-tracked AI policy enforcement event — no raw prompt/response."""

    __tablename__ = "ai_policy_violations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    stream_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("streams.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    ai_provider_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("ai_providers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    ai_stream_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("ai_streams.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    policy_rule_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("ai_policy_rules.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    provider: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    ai_stream: Mapped[str | None] = mapped_column(String(128), nullable=True)
    rule_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=VIOLATION_STATUS_OPEN, index=True)
    operator_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    acknowledged_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    resolved_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
