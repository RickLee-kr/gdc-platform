"""Persistence for per-Stream dynamic routing rules (M9 MVP)."""

from __future__ import annotations

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow


class StreamDynamicRoute(Base):
    """Policy-conditioned additive destination fan-out for a Stream."""

    __tablename__ = "stream_dynamic_routes"

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
    destination_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("destinations.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )
