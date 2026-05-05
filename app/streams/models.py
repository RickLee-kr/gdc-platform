"""SQLAlchemy model: Stream."""

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, utcnow


class Stream(Base):
    """Per-endpoint or per-query execution unit (master design §19.3)."""

    __tablename__ = "streams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    connector_id: Mapped[int] = mapped_column(ForeignKey("connectors.id"), nullable=False, index=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("sources.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    stream_type: Mapped[str] = mapped_column(String(64), nullable=False, default="HTTP_API_POLLING")
    config_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    polling_interval: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    status: Mapped[str] = mapped_column(String(64), nullable=False, default="STOPPED")
    rate_limit_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    connector = relationship("Connector", back_populates="streams")
    source = relationship("Source", back_populates="streams")
    mapping = relationship("Mapping", back_populates="stream", uselist=False)
    enrichment = relationship("Enrichment", back_populates="stream", uselist=False)
    routes = relationship("Route", back_populates="stream")
    checkpoint = relationship("Checkpoint", back_populates="stream", uselist=False)
