"""Persistence for per-Stream classification rules."""

from __future__ import annotations

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow

CLASSIFICATION_PUBLIC = "PUBLIC"
CLASSIFICATION_INTERNAL = "INTERNAL"
CLASSIFICATION_CONFIDENTIAL = "CONFIDENTIAL"
CLASSIFICATION_RESTRICTED = "RESTRICTED"

CLASSIFICATION_LEVELS = frozenset(
    {
        CLASSIFICATION_PUBLIC,
        CLASSIFICATION_INTERNAL,
        CLASSIFICATION_CONFIDENTIAL,
        CLASSIFICATION_RESTRICTED,
    }
)


class StreamClassificationRule(Base):
    __tablename__ = "stream_classification_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    stream_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("streams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    condition_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    classification_level: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
