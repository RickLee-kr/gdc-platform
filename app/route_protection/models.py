"""Per-route protection rule persistence (M13.3)."""

from __future__ import annotations

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow
from app.protection.models import PROTECTION_MODES


class RouteProtectionRule(Base):
    """Optional full route-specific protection rule set."""

    __tablename__ = "route_protection_rules"
    __table_args__ = (
        UniqueConstraint(
            "route_id",
            "field_path",
            name="uq_route_protection_rules_route_path",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    route_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("routes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    field_path: Mapped[str] = mapped_column(Text, nullable=False)
    sensitivity_class: Mapped[str] = mapped_column(String(32), nullable=False)
    protection_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    source_finding_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("stream_sensitive_findings.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by: Mapped[str] = mapped_column(String(128), nullable=False, default="system")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )


__all__ = ["PROTECTION_MODES", "RouteProtectionRule"]
