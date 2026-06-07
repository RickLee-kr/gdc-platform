"""SQLAlchemy models for named governance policies."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, utcnow

POLICY_STATUS_DRAFT = "DRAFT"
POLICY_STATUS_REVIEW = "REVIEW"
POLICY_STATUS_ACTIVE = "ACTIVE"
POLICY_STATUS_RETIRED = "RETIRED"
POLICY_STATUSES = frozenset(
    {
        POLICY_STATUS_DRAFT,
        POLICY_STATUS_REVIEW,
        POLICY_STATUS_ACTIVE,
        POLICY_STATUS_RETIRED,
    }
)

# Allowed forward-only lifecycle transitions (M18.4).
POLICY_LIFECYCLE_TRANSITIONS: dict[str, str] = {
    POLICY_STATUS_DRAFT: POLICY_STATUS_REVIEW,
    POLICY_STATUS_REVIEW: POLICY_STATUS_ACTIVE,
    POLICY_STATUS_ACTIVE: POLICY_STATUS_RETIRED,
}

POLICY_CATEGORY_DATA_PROTECTION = "DATA_PROTECTION"
POLICY_CATEGORY_AI_GOVERNANCE = "AI_GOVERNANCE"
POLICY_CATEGORY_COMPLIANCE = "COMPLIANCE"
POLICY_CATEGORY_CUSTOM = "CUSTOM"
POLICY_CATEGORIES = frozenset(
    {
        POLICY_CATEGORY_DATA_PROTECTION,
        POLICY_CATEGORY_AI_GOVERNANCE,
        POLICY_CATEGORY_COMPLIANCE,
        POLICY_CATEGORY_CUSTOM,
    }
)

CONDITION_OPERATORS = frozenset({"equals", "not_equals", "contains"})
POLICY_ACTION_TYPES = frozenset({"quarantine", "tokenize", "mask", "audit_only"})
CONDITION_FIELDS = frozenset({"classification", "sensitivity", "field"})


class GovernancePolicy(Base):
    __tablename__ = "governance_policies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=POLICY_STATUS_DRAFT)
    policy_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    assignments: Mapped[list[StreamPolicyAssignment]] = relationship(
        "StreamPolicyAssignment",
        back_populates="policy",
        cascade="all, delete-orphan",
    )


class StreamPolicyAssignment(Base):
    __tablename__ = "stream_policy_assignments"
    __table_args__ = (UniqueConstraint("stream_id", "policy_id", name="uq_stream_policy_assignments_stream_policy"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    stream_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("streams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    policy_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("governance_policies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    policy: Mapped[GovernancePolicy] = relationship("GovernancePolicy", back_populates="assignments")
