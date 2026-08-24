"""SQLAlchemy model: Credential (master design §19.10 — Connected Credential foundation)."""

from __future__ import annotations

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, JSON
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
CREDENTIAL_STATUS_EXPIRED = "EXPIRED"
CREDENTIAL_STATUS_REVOKED = "REVOKED"
CREDENTIAL_STATUS_NEEDS_RECONNECT = "NEEDS_RECONNECT"

AUTH_TYPE_OAUTH2_AUTHORIZATION_CODE = "OAUTH2_AUTHORIZATION_CODE"


class Credential(Base):
    """Reusable auth payload scoped to a connector (Source.credential_id).

    Secrets are stored as JSON in ``auth_json`` using the same contract as
    ``Source.auth_json`` (API masking; no encryption-at-rest subsystem yet —
    see docs/architecture/credential-encryption-at-rest.md).
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
    oauth_states = relationship(
        "CredentialOAuthState",
        back_populates="credential",
        cascade="all, delete-orphan",
    )


class CredentialOAuthState(Base):
    """One-time OAuth2 authorization ``state`` (+ optional PKCE verifier).

    Used for authorization-code callback correlation and replay prevention.
    """

    __tablename__ = "credential_oauth_states"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    state: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    credential_id: Mapped[int] = mapped_column(
        ForeignKey("credentials.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    code_verifier: Mapped[str | None] = mapped_column(String(128), nullable=True)
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    credential = relationship("Credential", back_populates="oauth_states")
