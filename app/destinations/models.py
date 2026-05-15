"""SQLAlchemy model: Destination."""

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text
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
    last_connectivity_test_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_connectivity_test_success: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    last_connectivity_test_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_connectivity_test_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    routes = relationship("Route", back_populates="destination")
