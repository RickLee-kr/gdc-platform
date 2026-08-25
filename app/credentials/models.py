"""SQLAlchemy model: Credential (master design §19.10 — Connected Credential foundation)."""

from __future__ import annotations

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, JSON, event
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

    Sensitive fields inside ``auth_json`` are encrypted at rest (AES-GCM envelopes).
    See docs/reference/architecture/credential-encryption-at-rest.md.
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


def _encrypt_credential_auth_json_on_flush(_mapper, _connection, target: Credential) -> None:
    """Encrypt plaintext secret fields before INSERT/UPDATE (idempotent)."""

    from app.security.auth_json_crypto import auth_json_for_storage, contains_plaintext_secrets

    raw = dict(target.auth_json or {})
    if contains_plaintext_secrets(raw):
        target.auth_json = auth_json_for_storage(raw)


event.listen(Credential, "before_insert", _encrypt_credential_auth_json_on_flush)
event.listen(Credential, "before_update", _encrypt_credential_auth_json_on_flush)
