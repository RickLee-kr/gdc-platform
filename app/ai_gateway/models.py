"""Persistence for AI Gateway policies and request audit."""

from __future__ import annotations

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow

GATEWAY_ACTION_ALLOW = "allow"
GATEWAY_ACTION_AUDIT = "audit"
GATEWAY_ACTION_BLOCK = "block"
GATEWAY_ACTION_QUARANTINE = "quarantine"

GATEWAY_ACTION_TYPES = (
    GATEWAY_ACTION_ALLOW,
    GATEWAY_ACTION_AUDIT,
    GATEWAY_ACTION_BLOCK,
    GATEWAY_ACTION_QUARANTINE,
)

GATEWAY_DECISION_ALLOW = GATEWAY_ACTION_ALLOW
GATEWAY_DECISION_AUDIT = GATEWAY_ACTION_AUDIT
GATEWAY_DECISION_BLOCK = GATEWAY_ACTION_BLOCK
GATEWAY_DECISION_QUARANTINE = GATEWAY_ACTION_QUARANTINE


class AiGatewayPolicy(Base):
    __tablename__ = "ai_gateway_policies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    condition_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    action_type: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )


class AiGatewayRequest(Base):
    __tablename__ = "ai_gateway_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True, index=True)
    stream_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("streams.id", ondelete="SET NULL"),
        nullable=True,
    )
    classification_level: Mapped[str] = mapped_column(String(32), nullable=False)
    decision: Mapped[str] = mapped_column(String(16), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    processing_time_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    matched_policy_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
