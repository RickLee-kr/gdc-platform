"""SQLAlchemy model: Destination."""

from sqlalchemy import JSON, Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, utcnow


class Destination(Base):
    """Syslog or webhook targets (master design §19.6)."""

    __tablename__ = "destinations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    destination_type: Mapped[str] = mapped_column(String(64), nullable=False)
    config_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    rate_limit_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    routes = relationship("Route", back_populates="destination")
