"""SQLAlchemy models: per-route mapping and enrichment (M13.2)."""

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, utcnow


class RouteMapping(Base):
    """Route-scoped field mapping configuration."""

    __tablename__ = "route_mappings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    route_id: Mapped[int] = mapped_column(ForeignKey("routes.id"), nullable=False, unique=True, index=True)
    field_mappings_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    raw_payload_mode: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    route = relationship("Route", back_populates="route_mapping")


class RouteEnrichment(Base):
    """Route-scoped enrichment configuration."""

    __tablename__ = "route_enrichments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    route_id: Mapped[int] = mapped_column(ForeignKey("routes.id"), nullable=False, unique=True, index=True)
    enrichment_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    override_policy: Mapped[str] = mapped_column(String(64), nullable=False, default="KEEP_EXISTING")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    route = relationship("Route", back_populates="route_enrichment")
