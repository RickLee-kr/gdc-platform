"""Pydantic schemas for Marketplace UI catalog/capabilities/validate/builder APIs (M29.8).

These are thin read/response models for the UI. They aggregate the existing
unified registry + lifecycle install rows; they do not introduce a new
runtime/registry/lifecycle engine.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class MarketplaceStreamRef(BaseModel):
    """One available stream template on a package."""

    id: str
    name: str


class MarketplaceStreamExtensionRef(BaseModel):
    """A stream_extension package that requires a given source package."""

    package_id: str
    name: str
    pack_version: str | None = None
    installed: bool = False


class MarketplaceVerificationRead(BaseModel):
    """Platform-derived signature verification evidence (never manifest self-claim)."""

    signature_status: str = "UNSIGNED"
    signing_key_id: str | None = None
    digest: str | None = None
    evidence_date: datetime | None = None


class MarketplaceLicenseRead(BaseModel):
    """Declared license + platform-derived license policy decision."""

    declared: str | None = None
    decision: str | None = None
    decision_code: str | None = None
    decision_reason: str | None = None


class MarketplaceProvenanceRead(BaseModel):
    """Safe upstream provenance fields (declared metadata only)."""

    upstream_project: str | None = None
    upstream_url: str | None = None
    upstream_path: str | None = None
    upstream_commit_or_version: str | None = None
    modified_from_upstream: bool | None = None
    import_method: str | None = None


class MarketplaceCompatibilityRead(BaseModel):
    """Platform compatibility warnings + declared requires (informational, non-fatal)."""

    warnings: list[str] = Field(default_factory=list)
    requires: Any | None = None


class MarketplacePackageCard(BaseModel):
    """One Marketplace catalog card / detail payload.

    Does not expose the raw full manifest by default.
    """

    package_id: str
    name: str
    vendor: str
    product: str | None = None
    description: str = ""
    package_kind: str = "source"
    pack_version: str | None = None
    api_version: str | None = None
    origin: str | None = None
    trust_tier: str
    validation_status: str = "valid"
    verification: MarketplaceVerificationRead = Field(default_factory=MarketplaceVerificationRead)
    license: MarketplaceLicenseRead = Field(default_factory=MarketplaceLicenseRead)
    provenance: MarketplaceProvenanceRead = Field(default_factory=MarketplaceProvenanceRead)
    compatibility: MarketplaceCompatibilityRead = Field(default_factory=MarketplaceCompatibilityRead)
    available_streams: list[MarketplaceStreamRef] = Field(default_factory=list)
    installed: bool = False
    installed_version: str | None = None
    update_available: bool = False
    previous_version: str | None = None
    stream_extensions: list[MarketplaceStreamExtensionRef] = Field(default_factory=list)
    requires: Any | None = None


class MarketplaceCatalogResponse(BaseModel):
    """Marketplace catalog listing envelope."""

    packages: list[MarketplacePackageCard] = Field(default_factory=list)
    count: int = 0


class MarketplaceCapabilitiesRead(BaseModel):
    """Platform-declared Marketplace UI capability flags (M29.8 / M29.9)."""

    git_acquisition: bool = False
    git_acquisition_reason: str = ""
    remote_registry: bool = True
    remote_registry_default_enabled: bool = False
    private_registry: bool = True
    offline_signed_bundle: bool = True
    production_ai_provider_implemented: bool = False
    deterministic_builder_providers: list[str] = Field(default_factory=lambda: ["fixture", "manual"])
    auto_install: bool = False
    auto_stream_create: bool = False
    auto_stream_enable: bool = False
    auto_credential_create: bool = False
    trust_auto_promotion: bool = False
    supported_upload_formats: list[str] = Field(default_factory=lambda: [".tar.gz", ".tgz"])
    supported_origins: list[str] = Field(
        default_factory=lambda: [
            "Builtin",
            "Upload",
            "Git",
            "Private Registry",
            "Remote Registry",
        ]
    )


class MarketplaceValidateResultRead(BaseModel):
    """Validate-only pipeline result (stage → secret scan → signature → deps → license)."""

    status: str  # PASS | FAIL | WARNING
    package_id: str | None = None
    package_kind: str | None = None
    pack_version: str | None = None
    name: str | None = None
    vendor: str | None = None
    issues: list[str] = Field(default_factory=list)
    signature_status: str = "UNSIGNED"
    signing_key_id: str | None = None
    digest: str | None = None
    license_decision: str | None = None
    license_decision_code: str | None = None
    license_decision_reason: str | None = None
    compatibility_warnings: list[str] = Field(default_factory=list)
    blocked_reasons: list[str] = Field(default_factory=list)


class MarketplaceBuilderDraftRequest(BaseModel):
    """Thin wrapper request for the AI Connector Builder (Local Draft only)."""

    provider_name: str | None = None
    vendor: str | None = None
    product: str | None = None
    desired_streams: list[str] = Field(default_factory=list)
    harvested_knowledge: dict[str, Any] | None = None
    openapi: dict[str, Any] | None = None
    sample: Any | None = None
    documentation: str | None = None
    script_reference: str | None = None
    supplied_translation: dict[str, Any] | None = None
    trust_candidate: str | None = None
    output_dir: str | None = None


class MarketplaceBuilderDraftResponse(BaseModel):
    """BuilderResult-shaped response (never auto-installs)."""

    status: str
    package_generated: bool
    package_path: str | None = None
    validation_status: str
    validation_issues: list[dict[str, Any]] = Field(default_factory=list)
    open_questions: list[dict[str, Any]] = Field(default_factory=list)
    conflicts: list[dict[str, Any]] = Field(default_factory=list)
    confidence_summary: dict[str, Any] = Field(default_factory=dict)
    evidence_summary: dict[str, Any] = Field(default_factory=dict)
    license_decision: str | None = None
    license_decision_code: str | None = None
    license_decision_reason: str | None = None
    trust_candidate: str
    validation_details: dict[str, Any] = Field(default_factory=dict)
    provider_name: str | None = None


class MarketplaceGitInstallRequest(BaseModel):
    """Install from an HTTPS URL pointing at a ``.tar.gz`` package archive."""

    url: str
    network_policy: dict[str, Any] | None = None
