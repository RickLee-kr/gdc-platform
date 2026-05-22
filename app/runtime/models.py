"""Runtime read-model materialization tables."""

from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow


class RuntimeStreamSnapshot(Base):
    """Operator read model for per-stream operational posture (Phase 4)."""

    __tablename__ = "runtime_stream_snapshot"

    stream_id: Mapped[int] = mapped_column(Integer, ForeignKey("streams.id", ondelete="CASCADE"), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    health_status: Mapped[str] = mapped_column(String(16), nullable=False, default="IDLE")
    eps_1m: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    eps_5m: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    success_rate_5m: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    failure_rate_5m: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    retry_rate_5m: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    avg_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    route_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    healthy_route_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_route_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_success_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    checkpoint_updated_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    checkpoint_lag_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class RuntimeRouteSnapshot(Base):
    """Operator read model for per-route delivery posture (Phase 4)."""

    __tablename__ = "runtime_route_snapshot"

    route_id: Mapped[int] = mapped_column(Integer, ForeignKey("routes.id", ondelete="CASCADE"), primary_key=True)
    stream_id: Mapped[int] = mapped_column(Integer, ForeignKey("streams.id", ondelete="CASCADE"), nullable=False)
    destination_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("destinations.id", ondelete="CASCADE"), nullable=False
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    health_status: Mapped[str] = mapped_column(String(16), nullable=False, default="IDLE")
    delivered_eps_1m: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    failed_eps_1m: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    success_rate_5m: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    retry_rate_5m: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    avg_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_success_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class RuntimeDestinationSnapshot(Base):
    """Operator read model for per-destination inbound posture (Phase 4)."""

    __tablename__ = "runtime_destination_snapshot"

    destination_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("destinations.id", ondelete="CASCADE"), primary_key=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    health_status: Mapped[str] = mapped_column(String(16), nullable=False, default="IDLE")
    inbound_eps_1m: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    failed_eps_1m: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    avg_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    route_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_success_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class RuntimeSnapshotUpdaterState(Base):
    """Singleton cursor for incremental operational snapshot updater."""

    __tablename__ = "runtime_snapshot_updater_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    last_delivery_log_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    last_scan_since: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


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

