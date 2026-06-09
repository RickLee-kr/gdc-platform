"""SQLAlchemy model: AiStream."""

from __future__ import annotations

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow


class AiStream(Base):
    """Operator-facing AI ingress facade bound 1:1 to a Stream row."""

    __tablename__ = "ai_streams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    stream_id: Mapped[int] = mapped_column(ForeignKey("streams.id", ondelete="CASCADE"), nullable=False)
    provider_id: Mapped[int] = mapped_column(ForeignKey("ai_providers.id", ondelete="RESTRICT"), nullable=False)
    slug: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
