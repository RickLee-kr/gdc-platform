"""SQLAlchemy model: platform-owned Marketplace remote/private registries (M29.9)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow

REGISTRY_TYPE_PRIVATE = "private"
REGISTRY_TYPE_REMOTE_PUBLIC = "remote_public"

REGISTRY_TYPES: tuple[str, ...] = (
    REGISTRY_TYPE_PRIVATE,
    REGISTRY_TYPE_REMOTE_PUBLIC,
)

# Remote public registry feature remains administrator-controlled and OFF by default.
REMOTE_PUBLIC_DEFAULT_ENABLED = False


class MarketplaceRegistry(Base):
    """Configured private or remote-public package registry.

    Secrets are never stored in plaintext. Optional auth material is encrypted
    via the platform secret helpers and never returned by read APIs.
    ``authentication_reference`` is an opaque reference only.
    """

    __tablename__ = "marketplace_registries"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    registry_type: Mapped[str] = mapped_column(String(32), nullable=False)
    base_url: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    enabled_for_browse: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    enabled_for_install: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Opaque reference only — never a plaintext token.
    authentication_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Encrypted auth envelopes (bearer_token etc.). Never exposed in API reads.
    auth_secret_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    trusted_key_policy: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    network_policy: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
