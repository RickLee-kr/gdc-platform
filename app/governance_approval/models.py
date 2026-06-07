"""Governance policy approval event model (M19.5)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow

APPROVAL_EVENT_SUBMITTED = "SUBMITTED_FOR_REVIEW"
APPROVAL_EVENT_APPROVED = "APPROVED"
APPROVAL_EVENT_REJECTED = "REJECTED"
APPROVAL_EVENT_REQUEST_CHANGES = "REQUEST_CHANGES"
APPROVAL_EVENT_ACTIVATED = "ACTIVATED"
APPROVAL_EVENT_CANCELLED = "CANCELLED"

APPROVAL_EVENT_TYPES = frozenset(
    {
        APPROVAL_EVENT_SUBMITTED,
        APPROVAL_EVENT_APPROVED,
        APPROVAL_EVENT_REJECTED,
        APPROVAL_EVENT_REQUEST_CHANGES,
        APPROVAL_EVENT_ACTIVATED,
        APPROVAL_EVENT_CANCELLED,
    }
)

APPROVAL_WINDOW_24H = "24h"
APPROVAL_WINDOW_7D = "7d"
APPROVAL_WINDOW_30D = "30d"

APPROVAL_WINDOWS = frozenset({APPROVAL_WINDOW_24H, APPROVAL_WINDOW_7D, APPROVAL_WINDOW_30D})

DEFAULT_ACTOR = "Governance Operator"


class GovernancePolicyApprovalEvent(Base):
    __tablename__ = "governance_policy_approval_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    policy_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("governance_policies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    actor: Mapped[str] = mapped_column(String(128), nullable=False, default=DEFAULT_ACTOR)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
