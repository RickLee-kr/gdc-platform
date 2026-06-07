"""M10 failover routing — Active/Standby primary → secondary."""

from __future__ import annotations

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow

FAILOVER_POLICY_ACTIVE_STANDBY = "ACTIVE_STANDBY"


class StreamFailoverRoute(Base):
    """Active/Standby failover: one secondary per primary destination on a stream."""

    __tablename__ = "stream_failover_routes"
    __table_args__ = (
        UniqueConstraint(
            "stream_id",
            "primary_destination_id",
            name="uq_stream_failover_routes_stream_primary",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    stream_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("streams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    primary_destination_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("destinations.id", ondelete="RESTRICT"),
        nullable=False,
    )
    secondary_destination_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("destinations.id", ondelete="RESTRICT"),
        nullable=False,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )
