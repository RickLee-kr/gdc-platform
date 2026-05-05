"""SQLAlchemy model: Route."""

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, utcnow


class Route(Base):
    """Connects stream to destination with route-level policy (master design §19.7)."""

    __tablename__ = "routes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    stream_id: Mapped[int] = mapped_column(ForeignKey("streams.id"), nullable=False, index=True)
    destination_id: Mapped[int] = mapped_column(ForeignKey("destinations.id"), nullable=False, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    failure_policy: Mapped[str] = mapped_column(String(64), nullable=False, default="LOG_AND_CONTINUE")
    formatter_config_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    rate_limit_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(64), nullable=False, default="ENABLED")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    stream = relationship("Stream", back_populates="routes")
    destination = relationship("Destination", back_populates="routes")
