"""SQLAlchemy model: Enrichment."""

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, utcnow


class Enrichment(Base):
    """Static/calculated enrichment settings (master design §19.5)."""

    __tablename__ = "enrichments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    stream_id: Mapped[int] = mapped_column(ForeignKey("streams.id"), nullable=False, unique=True, index=True)
    enrichment_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    override_policy: Mapped[str] = mapped_column(String(64), nullable=False, default="KEEP_EXISTING")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    stream = relationship("Stream", back_populates="enrichment")
