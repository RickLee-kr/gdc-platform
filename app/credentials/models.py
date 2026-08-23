"""SQLAlchemy model: Credential (master design §19.10 — Connected Credential foundation)."""

from __future__ import annotations

from sqlalchemy import DateTime, ForeignKey, Integer, String, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, utcnow

# Runtime-usable status. Non-CONNECTED values block credential-based auth resolution.
CREDENTIAL_STATUSES: tuple[str, ...] = (
    "CONNECTED",
    "EXPIRED",
    "REVOKED",
    "NEEDS_RECONNECT",
)

CREDENTIAL_STATUS_CONNECTED = "CONNECTED"


class Credential(Base):
    """Reusable auth payload scoped to a connector (Source.credential_id).

    Secrets are stored as JSON in ``auth_json`` using the same contract as
    ``Source.auth_json`` (API masking; no separate encryption-at-rest subsystem).
    """

    __tablename__ = "credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    connector_id: Mapped[int] = mapped_column(
        ForeignKey("connectors.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    auth_type: Mapped[str] = mapped_column(String(64), nullable=False)
    auth_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(64), nullable=False, default=CREDENTIAL_STATUS_CONNECTED)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    connector = relationship("Connector", back_populates="credentials")
    sources = relationship("Source", back_populates="credential")
