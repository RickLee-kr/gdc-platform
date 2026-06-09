"""Persistence for AI policy rules (M22)."""

from __future__ import annotations

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow

AI_POLICY_TARGET_PROMPT = "prompt"
AI_POLICY_TARGET_RESPONSE = "response"
AI_POLICY_TARGETS = (AI_POLICY_TARGET_PROMPT, AI_POLICY_TARGET_RESPONSE)

AI_POLICY_INSPECTION_REGEX = "regex"
AI_POLICY_INSPECTION_KEYWORD = "keyword"
AI_POLICY_INSPECTION_PII = "pii"
AI_POLICY_INSPECTION_SECRET_PATTERN = "secret_pattern"
AI_POLICY_INSPECTION_SENSITIVE_CONTENT = "sensitive_content"
AI_POLICY_INSPECTION_TYPES = (
    AI_POLICY_INSPECTION_REGEX,
    AI_POLICY_INSPECTION_KEYWORD,
    AI_POLICY_INSPECTION_PII,
    AI_POLICY_INSPECTION_SECRET_PATTERN,
    AI_POLICY_INSPECTION_SENSITIVE_CONTENT,
)

AI_POLICY_ACTION_ALLOW = "allow"
AI_POLICY_ACTION_DENY = "deny"
AI_POLICY_ACTION_MASK = "mask"
AI_POLICY_ACTION_REDACT = "redact"
AI_POLICY_ACTION_BLOCK = "block"
AI_POLICY_ACTION_TYPES = (
    AI_POLICY_ACTION_ALLOW,
    AI_POLICY_ACTION_DENY,
    AI_POLICY_ACTION_MASK,
    AI_POLICY_ACTION_REDACT,
    AI_POLICY_ACTION_BLOCK,
)

AI_POLICY_BLOCKING_ACTIONS = frozenset(
    {AI_POLICY_ACTION_DENY, AI_POLICY_ACTION_BLOCK}
)


class AiPolicyRule(Base):
    __tablename__ = "ai_policy_rules"
    __table_args__ = (
        UniqueConstraint("ai_stream_id", "name", name="uq_ai_policy_rules_stream_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ai_stream_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("ai_streams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    target: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    inspection_type: Mapped[str] = mapped_column(String(32), nullable=False)
    condition_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    action_type: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )
