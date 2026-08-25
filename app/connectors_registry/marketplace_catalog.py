"""Marketplace UI catalog aggregation + platform-derived trust tier (M29.8).

Aggregates the existing unified registry (builtin + installed modules) with
platform-owned lifecycle install rows into Marketplace catalog cards. This
module does not add a new runtime/registry/lifecycle engine — it is a thin
read-side view over ``app.connectors_registry.service`` and
``MarketplacePackageInstall``.

Trust tier is always platform-derived here. Manifest self-claims for
``trust_tier`` / ``origin`` / ``signature_status`` / ``license_decision`` /
``Verified`` / ``Official`` are never trusted (already stripped by the
validator at install time); this module only reads platform-owned signals:
registry ``installed_from``, the lifecycle install row's signature evidence,
and declared provenance markers written by the platform's own Harvester /
AI Builder pipelines (never by arbitrary uploaded packages claiming those
same marker values for themselves — those pipelines are the only writers
exercised by this platform for those specific marker fields today).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.connectors_registry.lifecycle_dependencies import iter_requirements
from app.connectors_registry.lifecycle_models import LIFECYCLE_STATUS_INSTALLED, MarketplacePackageInstall
from app.connectors_registry.license_policy import LicensePolicyResult, evaluate_manifest_license_policy
from app.connectors_registry.marketplace_schemas import (
    MarketplaceCompatibilityRead,
    MarketplaceLicenseRead,
    MarketplacePackageCard,
    MarketplaceProvenanceRead,
    MarketplaceStreamExtensionRef,
    MarketplaceStreamRef,
    MarketplaceVerificationRead,
)
from app.connectors_registry.models import ConnectorManifest
from app.connectors_registry.schemas import ConnectorRegistrySummary, ResolvedConnectorRead
from app.connectors_registry.service import (
    get_connector_manifest,
    get_connector_resources,
    list_connector_summaries,
)

TRUST_TIER_OFFICIAL = "Official"
TRUST_TIER_LOCAL_DRAFT = "Local Draft"
TRUST_TIER_IMPORTED = "Imported"
TRUST_TIER_COMMUNITY = "Community"
TRUST_TIER_PRIVATE = "Private"

SIGNATURE_STATUS_VALID = "VALID"

_BUILDER_TRUST_IMPORTED_DRAFT = "Imported Draft"
_HARVESTER_TRUST_LOCAL_DRAFT = "Local Draft"


def _upstream_provenance_dict(manifest: ConnectorManifest | None) -> dict[str, Any]:
    """Return declared ``upstream_provenance`` as a plain dict (extra fields included)."""

    if manifest is None or manifest.upstream_provenance is None:
        return {}
    up = manifest.upstream_provenance
    data = up.model_dump()
    extra = getattr(up, "model_extra", None) or {}
    for key, value in extra.items():
        data[key] = value
    return data


def derive_trust_tier(
    *,
    installed_from: str | None,
    capabilities: dict[str, Any] | None,
    upstream_provenance: dict[str, Any] | None,
    signature_status: str | None,
) -> str:
    """Compute the platform-owned Marketplace trust tier for one package.

    Order of precedence:

    1. ``installed_from == "builtin"`` → Official
    2. AI Builder draft markers (``capabilities.builder_draft`` or
       ``upstream_provenance.import_method == "ai_builder"``) → Local Draft
       (Imported Draft variant maps to Imported)
    3. Harvester import markers (``capabilities.harvester_draft`` or any
       declared ``import_method``) → Imported (Local Draft variant kept)
    4. Verified platform signature (``signature_status == VALID``) → Community
       (never Verified/Official — human verification review is out of scope)
    5. Otherwise (installed unsigned upload, no markers) → Private
    """

    if installed_from == "builtin":
        return TRUST_TIER_OFFICIAL

    caps = capabilities or {}
    prov = upstream_provenance or {}
    import_method = str(prov.get("import_method") or "").strip()

    if bool(caps.get("builder_draft")) or import_method == "ai_builder":
        candidate = str(prov.get("builder_trust_candidate") or "").strip()
        return TRUST_TIER_IMPORTED if candidate == _BUILDER_TRUST_IMPORTED_DRAFT else TRUST_TIER_LOCAL_DRAFT

    if bool(caps.get("harvester_draft")) or (import_method and import_method != "ai_builder"):
        candidate = str(prov.get("harvester_trust_candidate") or "").strip()
        return TRUST_TIER_LOCAL_DRAFT if candidate == _HARVESTER_TRUST_LOCAL_DRAFT else TRUST_TIER_IMPORTED

    if signature_status == SIGNATURE_STATUS_VALID:
        return TRUST_TIER_COMMUNITY

    return TRUST_TIER_PRIVATE


def summarize_compatibility_warnings(manifest: ConnectorManifest | None) -> list[str]:
    """Human-readable platform compatibility notes (parse-only, non-fatal)."""

    if manifest is None:
        return []
    warnings: list[str] = []
    compat = getattr(manifest, "platform_compatibility", None)
    if isinstance(compat, dict):
        min_v = compat.get("min_platform_version")
        max_v = compat.get("max_platform_version")
        if isinstance(min_v, str) and min_v.strip():
            warnings.append(f"Requires platform version >= {min_v.strip()}")
        if isinstance(max_v, str) and max_v.strip():
            warnings.append(f"Requires platform version <= {max_v.strip()}")
        supported = compat.get("supported_source_types")
        if isinstance(supported, list) and supported and manifest.source_type not in supported:
            warnings.append(
                f"Declared supported_source_types {supported!r} does not include "
                f"{manifest.source_type!r}"
            )
    return warnings


def dependency_compatibility_notes(
    manifest: ConnectorManifest | None,
    available_versions: dict[str, str],
) -> list[str]:
    """Informational (non-fatal) notes about declared ``requires`` availability."""

    if manifest is None:
        return []
    notes: list[str] = []
    for requirement in iter_requirements(manifest):
        required_id = requirement.package_id.strip()
        if not required_id:
            continue
        if required_id not in available_versions:
            notes.append(f"Requires package {required_id!r} which is not currently installed")
        elif requirement.version:
            notes.append(
                f"Requires package {required_id!r} version {requirement.version!r} "
                f"(installed: {available_versions[required_id]!r})"
            )
    return notes


def _available_versions_map() -> dict[str, str]:
    versions: dict[str, str] = {}
    for summary in list_connector_summaries():
        package_id = (summary.package_id or summary.id or "").strip()
        pack_version = (summary.pack_version or summary.version or "").strip()
        if package_id and pack_version:
            versions[package_id] = pack_version
        if summary.id and pack_version:
            versions[summary.id] = pack_version
    return versions


def _lifecycle_rows_by_id(db: Session) -> dict[str, MarketplacePackageInstall]:
    rows = db.query(MarketplacePackageInstall).all()
    return {row.package_id: row for row in rows}


def _stream_refs(manifest: ConnectorManifest | None) -> list[MarketplaceStreamRef]:
    if manifest is None:
        return []
    return [MarketplaceStreamRef(id=s.id, name=s.name) for s in manifest.streams]


def _requires_payload(manifest: ConnectorManifest | None) -> list[dict[str, Any]] | None:
    if manifest is None or manifest.requires is None:
        return None
    return [
        {"package_id": r.package_id, "version": r.version}
        for r in iter_requirements(manifest)
    ]


def _resolved_detail(connector_id: str, cache: dict[str, ResolvedConnectorRead | None]) -> ResolvedConnectorRead | None:
    if connector_id not in cache:
        found = get_connector_manifest(connector_id)
        cache[connector_id] = found.resolved if found is not None else None
    return cache[connector_id]


def _build_extension_index(
    summaries: list[ConnectorRegistrySummary],
    detail_cache: dict[str, ResolvedConnectorRead | None],
) -> dict[str, list[ConnectorRegistrySummary]]:
    index: dict[str, list[ConnectorRegistrySummary]] = {}
    for summary in summaries:
        if (summary.package_kind or "source") != "stream_extension":
            continue
        detail = _resolved_detail(summary.id, detail_cache)
        manifest = detail.manifest if detail is not None else None
        for requirement in iter_requirements(manifest):
            required_id = requirement.package_id.strip()
            if not required_id:
                continue
            index.setdefault(required_id, []).append(summary)
    return index


def _card_for_summary(
    summary: ConnectorRegistrySummary,
    *,
    detail_cache: dict[str, ResolvedConnectorRead | None],
    lifecycle_by_id: dict[str, MarketplacePackageInstall],
    available_versions: dict[str, str],
    extension_index: dict[str, list[ConnectorRegistrySummary]],
    installed_ids: set[str],
) -> MarketplacePackageCard:
    package_id = (summary.package_id or summary.id or "").strip()
    detail = _resolved_detail(summary.id, detail_cache)
    manifest = detail.manifest if detail is not None else None

    resources = get_connector_resources(summary.id)
    docs = resources.docs if resources is not None else None
    description = (docs.summary if docs is not None and docs.summary else "") or ""

    lifecycle_row = lifecycle_by_id.get(package_id) or lifecycle_by_id.get(summary.id)
    is_installed = lifecycle_row is not None and lifecycle_row.status == LIFECYCLE_STATUS_INSTALLED

    signature_status: str | None = None
    signing_key_id: str | None = None
    digest: str | None = None
    evidence_date = None
    previous_version: str | None = None
    if is_installed and lifecycle_row is not None:
        signature_status = lifecycle_row.signature_status
        signing_key_id = lifecycle_row.signing_key_id
        digest = lifecycle_row.digest
        evidence_date = lifecycle_row.updated_at or lifecycle_row.installed_at
        previous_version = lifecycle_row.previous_version

    upstream_prov = _upstream_provenance_dict(manifest)
    capabilities = dict(manifest.capabilities) if manifest is not None else dict(summary.capabilities or {})

    trust_tier = derive_trust_tier(
        installed_from=summary.installed_from,
        capabilities=capabilities,
        upstream_provenance=upstream_prov,
        signature_status=signature_status,
    )

    license_policy: LicensePolicyResult | None = None
    if manifest is not None:
        license_policy = evaluate_manifest_license_policy(manifest)

    compat_warnings = summarize_compatibility_warnings(manifest)
    compat_warnings += dependency_compatibility_notes(manifest, available_versions)

    extension_refs: dict[str, MarketplaceStreamExtensionRef] = {}
    for candidate_id in {package_id, summary.id}:
        for ext in extension_index.get(candidate_id, []):
            ext_package_id = (ext.package_id or ext.id or "").strip()
            extension_refs[ext.id] = MarketplaceStreamExtensionRef(
                package_id=ext_package_id,
                name=ext.name,
                pack_version=ext.pack_version,
                installed=ext_package_id in installed_ids or ext.id in installed_ids,
            )

    requires_payload = _requires_payload(manifest)
    product = getattr(manifest, "product", None) if manifest is not None else None
    api_version = getattr(manifest, "api_version", None) if manifest is not None else None

    return MarketplacePackageCard(
        package_id=package_id or summary.id,
        name=summary.name,
        vendor=summary.vendor,
        product=product if isinstance(product, str) else None,
        description=description,
        package_kind=summary.package_kind or "source",
        pack_version=summary.pack_version or summary.version,
        api_version=api_version if isinstance(api_version, str) else None,
        origin=summary.installed_from or "builtin",
        trust_tier=trust_tier,
        validation_status=summary.status,
        verification=MarketplaceVerificationRead(
            signature_status=signature_status or "UNSIGNED",
            signing_key_id=signing_key_id,
            digest=digest,
            evidence_date=evidence_date,
        ),
        license=MarketplaceLicenseRead(
            declared=license_policy.declared.license_identifier if license_policy is not None else None,
            decision=license_policy.decision if license_policy is not None else None,
            decision_code=license_policy.decision_code if license_policy is not None else None,
            decision_reason=license_policy.decision_reason if license_policy is not None else None,
        ),
        provenance=MarketplaceProvenanceRead(
            upstream_project=upstream_prov.get("upstream_project"),
            upstream_url=upstream_prov.get("upstream_url"),
            upstream_path=upstream_prov.get("upstream_path"),
            upstream_commit_or_version=upstream_prov.get("upstream_commit_or_version"),
            modified_from_upstream=upstream_prov.get("modified_from_upstream"),
            import_method=upstream_prov.get("import_method"),
        ),
        compatibility=MarketplaceCompatibilityRead(warnings=compat_warnings, requires=requires_payload),
        available_streams=_stream_refs(manifest),
        installed=is_installed,
        installed_version=lifecycle_row.pack_version if is_installed and lifecycle_row is not None else None,
        update_available=False,
        previous_version=previous_version,
        stream_extensions=sorted(extension_refs.values(), key=lambda e: e.package_id),
        requires=requires_payload,
    )


def _minimal_card_from_lifecycle_row(row: MarketplacePackageInstall) -> MarketplacePackageCard:
    """Best-effort card for an installed package missing from the in-memory registry cache."""

    trust_tier = derive_trust_tier(
        installed_from="installed",
        capabilities={},
        upstream_provenance={},
        signature_status=row.signature_status,
    )
    return MarketplacePackageCard(
        package_id=row.package_id,
        name=row.package_id,
        vendor="—",
        description="",
        package_kind=row.package_kind,
        pack_version=row.pack_version,
        origin="installed",
        trust_tier=trust_tier,
        validation_status="invalid",
        verification=MarketplaceVerificationRead(
            signature_status=row.signature_status or "UNSIGNED",
            signing_key_id=row.signing_key_id,
            digest=row.digest,
            evidence_date=row.updated_at or row.installed_at,
        ),
        installed=True,
        installed_version=row.pack_version,
        previous_version=row.previous_version,
    )


def build_catalog(db: Session) -> list[MarketplacePackageCard]:
    """Aggregate unified registry + lifecycle install rows into catalog cards."""

    summaries = list_connector_summaries()
    lifecycle_by_id = _lifecycle_rows_by_id(db)
    installed_ids = {
        pid for pid, row in lifecycle_by_id.items() if row.status == LIFECYCLE_STATUS_INSTALLED
    }
    available_versions = _available_versions_map()
    detail_cache: dict[str, ResolvedConnectorRead | None] = {}
    extension_index = _build_extension_index(summaries, detail_cache)

    cards = [
        _card_for_summary(
            summary,
            detail_cache=detail_cache,
            lifecycle_by_id=lifecycle_by_id,
            available_versions=available_versions,
            extension_index=extension_index,
            installed_ids=installed_ids,
        )
        for summary in summaries
    ]

    known_ids = {card.package_id for card in cards}
    for package_id, row in lifecycle_by_id.items():
        if row.status != LIFECYCLE_STATUS_INSTALLED or package_id in known_ids:
            continue
        cards.append(_minimal_card_from_lifecycle_row(row))

    cards.sort(key=lambda c: c.package_id)
    return cards


def filter_catalog(
    cards: list[MarketplacePackageCard],
    *,
    q: str | None = None,
    trust_tier: str | None = None,
    origin: str | None = None,
    installed: bool | None = None,
    compatibility: str | None = None,
    package_kind: str | None = None,
) -> list[MarketplacePackageCard]:
    """Apply Marketplace UI browse filters over aggregated catalog cards."""

    results = cards
    if q:
        needle = q.strip().lower()
        if needle:
            results = [
                c
                for c in results
                if needle in c.package_id.lower()
                or needle in c.vendor.lower()
                or needle in c.name.lower()
                or (c.product or "").lower().find(needle) >= 0
            ]
    if trust_tier:
        results = [c for c in results if c.trust_tier == trust_tier]
    if origin:
        results = [c for c in results if (c.origin or "") == origin]
    if installed is not None:
        results = [c for c in results if c.installed == installed]
    if package_kind:
        results = [c for c in results if c.package_kind == package_kind]
    if compatibility:
        wants_warning = compatibility.strip().lower() in {"warning", "warnings", "incompatible"}
        wants_compatible = compatibility.strip().lower() in {"compatible", "ok", "clean"}
        if wants_warning:
            results = [c for c in results if c.compatibility.warnings]
        elif wants_compatible:
            results = [c for c in results if not c.compatibility.warnings]
    return results


def get_package_card(db: Session, package_id: str) -> MarketplacePackageCard | None:
    """Return full detail for one package (same shape as catalog cards)."""

    for card in build_catalog(db):
        if card.package_id == package_id:
            return card
    return None
