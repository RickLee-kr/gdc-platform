"""SQLAlchemy model: Source."""

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, utcnow


class Source(Base):
    """Data acquisition mode for a connector (master design §19.2)."""

    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    connector_id: Mapped[int] = mapped_column(ForeignKey("connectors.id"), nullable=False, index=True)
    source_type: Mapped[str] = mapped_column(String(64), nullable=False)
    config_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Legacy inline auth; kept for backward compatibility when credential_id is null.
    auth_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    credential_id: Mapped[int | None] = mapped_column(
        ForeignKey("credentials.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    connector = relationship("Connector", back_populates="sources")
    credential = relationship("Credential", back_populates="sources")
    streams = relationship("Stream", back_populates="source")
