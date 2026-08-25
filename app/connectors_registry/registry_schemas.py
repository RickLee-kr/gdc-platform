"""Pydantic schemas for Marketplace remote/private registries (M29.9)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.connectors_registry.registry_models import (
    REGISTRY_TYPE_PRIVATE,
    REGISTRY_TYPE_REMOTE_PUBLIC,
    REMOTE_PUBLIC_DEFAULT_ENABLED,
)


class RegistryNetworkPolicyWrite(BaseModel):
    """Administrator network policy for a registry (allowlist / limits)."""

    allowed_hosts: list[str] = Field(default_factory=list)
    allowed_ports: list[int] = Field(default_factory=list)
    allow_http: bool = False
    allow_private_networks: bool = False
    timeout_seconds: float | None = None
    max_response_bytes: int | None = None
    max_download_bytes: int | None = None


class RegistryTrustedKeyPolicyWrite(BaseModel):
    """Optional trusted-key constraints for packages from this registry."""

    require_signature: bool = False
    allowed_key_ids: list[str] = Field(default_factory=list)


class MarketplaceRegistryCreate(BaseModel):
    """Create a private or remote-public registry.

    Optional ``bearer_token`` is encrypted at rest and never returned by reads.
    Prefer ``authentication_reference`` as an opaque pointer to existing secrets.
    """

    name: str
    registry_type: str
    base_url: str
    enabled: bool | None = None
    enabled_for_browse: bool = True
    enabled_for_install: bool = True
    authentication_reference: str | None = None
    bearer_token: str | None = None
    trusted_key_policy: dict[str, Any] | None = None
    network_policy: dict[str, Any] | None = None

    @field_validator("registry_type")
    @classmethod
    def _validate_type(cls, value: str) -> str:
        text = (value or "").strip().lower()
        if text not in {REGISTRY_TYPE_PRIVATE, REGISTRY_TYPE_REMOTE_PUBLIC}:
            raise ValueError(
                f"registry_type must be {REGISTRY_TYPE_PRIVATE!r} or {REGISTRY_TYPE_REMOTE_PUBLIC!r}"
            )
        return text

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        text = (value or "").strip()
        if not text:
            raise ValueError("name is required")
        return text

    @field_validator("base_url")
    @classmethod
    def _validate_base_url(cls, value: str) -> str:
        text = (value or "").strip()
        if not text:
            raise ValueError("base_url is required")
        return text.rstrip("/")


class MarketplaceRegistryUpdate(BaseModel):
    """Partial update for a registry. Secrets are write-only."""

    name: str | None = None
    base_url: str | None = None
    enabled: bool | None = None
    enabled_for_browse: bool | None = None
    enabled_for_install: bool | None = None
    authentication_reference: str | None = None
    bearer_token: str | None = None
    clear_auth_secret: bool = False
    trusted_key_policy: dict[str, Any] | None = None
    network_policy: dict[str, Any] | None = None


class MarketplaceRegistryRead(BaseModel):
    """Safe registry read model — never includes plaintext secrets."""

    id: str
    name: str
    registry_type: str
    base_url: str
    enabled: bool
    enabled_for_browse: bool
    enabled_for_install: bool
    authentication_reference: str | None = None
    has_auth_secret: bool = False
    trusted_key_policy: dict[str, Any] | None = None
    network_policy: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime


class MarketplaceRegistryListResponse(BaseModel):
    registries: list[MarketplaceRegistryRead] = Field(default_factory=list)
    count: int = 0
    remote_public_default_enabled: bool = REMOTE_PUBLIC_DEFAULT_ENABLED


class MarketplaceRegistryConnectionTestResult(BaseModel):
    status: str  # PASS | FAIL
    registry_id: str
    message: str
    latency_ms: float | None = None
    error_code: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class RegistryPackageSummary(BaseModel):
    """One package entry from a remote/private registry catalog."""

    package_id: str
    name: str | None = None
    vendor: str | None = None
    pack_version: str | None = None
    description: str | None = None
    package_kind: str | None = None
    versions: list[str] = Field(default_factory=list)
    # Registry-declared trust claims are informational only — not authoritative.
    declared_trust_tier: str | None = None
    registry_id: str | None = None
    registry_name: str | None = None
    registry_type: str | None = None
    origin: str | None = None


class RegistryCatalogResponse(BaseModel):
    packages: list[RegistryPackageSummary] = Field(default_factory=list)
    count: int = 0
    registry_id: str | None = None
    unavailable: bool = False
    unavailable_reason: str | None = None
    error_code: str | None = None


class RegistryAcquireRequest(BaseModel):
    package_id: str
    pack_version: str | None = None


class RegistryAcquireInstallRequest(BaseModel):
    """Acquire from registry then install via existing lifecycle."""

    package_id: str
    pack_version: str | None = None
