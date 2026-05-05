"""SQLAlchemy model: Checkpoint."""

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, utcnow


class Checkpoint(Base):
    """Stream cursor state (master design §19.8)."""

    __tablename__ = "checkpoints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    stream_id: Mapped[int] = mapped_column(ForeignKey("streams.id"), nullable=False, unique=True, index=True)
    checkpoint_type: Mapped[str] = mapped_column(String(64), nullable=False, default="CUSTOM_FIELD")
    checkpoint_value_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    stream = relationship("Stream", back_populates="checkpoint")
