"""AI audit events for inspection enforcement (M23)."""

from __future__ import annotations

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow

AI_AUDIT_EVENT_PROMPT_INSPECTED = "PROMPT_INSPECTED"
AI_AUDIT_EVENT_PROMPT_BLOCKED = "PROMPT_BLOCKED"
AI_AUDIT_EVENT_PROMPT_MASKED = "PROMPT_MASKED"
AI_AUDIT_EVENT_RESPONSE_INSPECTED = "RESPONSE_INSPECTED"
AI_AUDIT_EVENT_RESPONSE_BLOCKED = "RESPONSE_BLOCKED"
AI_AUDIT_EVENT_RESPONSE_MASKED = "RESPONSE_MASKED"

AI_AUDIT_EVENT_TYPES = (
    AI_AUDIT_EVENT_PROMPT_INSPECTED,
    AI_AUDIT_EVENT_PROMPT_BLOCKED,
    AI_AUDIT_EVENT_PROMPT_MASKED,
    AI_AUDIT_EVENT_RESPONSE_INSPECTED,
    AI_AUDIT_EVENT_RESPONSE_BLOCKED,
    AI_AUDIT_EVENT_RESPONSE_MASKED,
)


class AiAuditEvent(Base):
    """Structured audit record for AI policy inspection — no raw prompt/response."""

    __tablename__ = "ai_audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
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
    request_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    policy_rule_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("ai_policy_rules.id", ondelete="SET NULL"),
        nullable=True,
    )
    action: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    matched_rule: Mapped[str | None] = mapped_column(String(256), nullable=True)
    matched_pattern: Mapped[str | None] = mapped_column(String(512), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
