"""SQLAlchemy model: Mapping."""

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, utcnow


class Mapping(Base):
    """JSONPath / field mapping configuration (master design §19.4)."""

    __tablename__ = "mappings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    stream_id: Mapped[int] = mapped_column(ForeignKey("streams.id"), nullable=False, unique=True, index=True)
    event_array_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    event_root_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    field_mappings_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    raw_payload_mode: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    stream = relationship("Stream", back_populates="mapping")
