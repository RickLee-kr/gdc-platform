"""Runtime read-model materialization tables."""

from __future__ import annotations

from sqlalchemy import BigInteger, DateTime, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow


class RuntimeAggregateSnapshot(Base):
    """Materialized read-only aggregate response for one snapshot scope/key."""

    __tablename__ = "runtime_aggregate_snapshots"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    snapshot_scope: Mapped[str] = mapped_column(String(64), nullable=False)
    snapshot_key: Mapped[str] = mapped_column(String(512), nullable=False)
    snapshot_id: Mapped[str] = mapped_column(String(64), nullable=False)
    generated_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
    window_start: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
    window_end: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
    payload_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    metric_meta_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    visualization_meta_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)

