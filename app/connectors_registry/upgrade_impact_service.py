"""Read-only Marketplace Update Impact Preview.

Compares the installed package against a candidate archive without mutating
catalog, stream config, checkpoints, schema baselines, or credentials.
Apply remains ``upgrade_package`` (catalog-only).
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO

from sqlalchemy.orm import Session, joinedload

from app.connectors_registry.lifecycle_archive import StagedPackage, cleanup_staging
from app.connectors_registry.lifecycle_errors import LifecycleError
from app.connectors_registry.lifecycle_models import (
    LIFECYCLE_STATUS_INSTALLED,
    MarketplacePackageInstall,
)
from app.connectors_registry.lifecycle_provenance import (
    PROVENANCE_CONFIG_KEY,
    streams_depending_on_package,
)
from app.connectors_registry.lifecycle_publish import active_package_path
from app.connectors_registry.lifecycle_service import (
    _available_package_versions,
    _stage_from_upload,
)
from app.connectors_registry.package_validator import validate_package_dependencies
from app.connectors_registry.roots import installed_plugins_root
from app.connectors_registry.loader import (
    _MANIFEST_FILENAMES,
    _load_module_resources,
    _read_manifest_file,
)
from app.connectors_registry.models import ConnectorManifest
from app.connectors_registry.normalize import normalize_manifest_dict
from app.connectors_registry.package_signature import (
    SIGNATURE_STATUS_UNSIGNED,
    SIGNATURE_STATUS_VALID,
    verify_package_signature,
)
from app.connectors_registry.upgrade_impact_schemas import (
    UpgradeImpactAffected,
    UpgradeImpactAffectedDestination,
    UpgradeImpactAffectedRoute,
    UpgradeImpactAffectedStream,
    UpgradeImpactFieldChange,
    UpgradeImpactIssue,
    UpgradeImpactPreviewResponse,
    UpgradeImpactRecommendation,
    UpgradeImpactTestResult,
)
from app.destinations.models import Destination
from app.platform_admin.config_json_diff import diff_json
from app.routes.models import Route
from app.streams.models import Stream


def _utc_aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _ts_equal(a: datetime | None, b: datetime | None) -> bool:
    aa = _utc_aware(a)
    bb = _utc_aware(b)
    if aa is None or bb is None:
        return aa is bb
    return abs((aa - bb).total_seconds()) < 0.001


def _issue(
    code: str,
    message: str,
    *,
    severity: str = "warning",
    path: str | None = None,
) -> UpgradeImpactIssue:
    return UpgradeImpactIssue(code=code, message=message, severity=severity, path=path)  # type: ignore[arg-type]


def _load_manifest_from_dir(package_root: Path) -> ConnectorManifest:
    for name in _MANIFEST_FILENAMES:
        path = package_root / name
        if not path.is_file():
            continue
        raw = normalize_manifest_dict(_read_manifest_file(path))
        return ConnectorManifest.model_validate(raw)
    raise LifecycleError(
        f"manifest missing under {package_root}",
        error_code="MANIFEST_MISSING",
    )


def _requires_snapshot(manifest: ConnectorManifest) -> Any:
    req = manifest.requires
    if req is None:
        return None
    if isinstance(req, list):
        return [item.model_dump() if hasattr(item, "model_dump") else item for item in req]
    if hasattr(req, "model_dump"):
        return req.model_dump()
    return req


def _package_snapshot(
    *,
    manifest: ConnectorManifest,
    package_root: Path,
) -> dict[str, Any]:
    resources, _issues = _load_module_resources(
        package_root,
        connector_id=str(manifest.package_id or manifest.id),
        manifest=manifest,
    )
    stream_ids = sorted({ref.id for ref in manifest.streams} | set(resources.streams.keys()))
    return {
        "pack_version": manifest.pack_version or manifest.version,
        "api_version": manifest.api_version,
        "auth": manifest.auth.model_dump() if manifest.auth is not None else None,
        "source_type": manifest.source_type,
        "streams": [
            {
                "id": ref.id,
                "name": ref.name,
                "template": ref.template,
                "default_mapping": ref.default_mapping,
                "default_enrichment": ref.default_enrichment,
            }
            for ref in sorted(manifest.streams, key=lambda s: s.id)
        ],
        "stream_ids": stream_ids,
        "stream_templates": {k: resources.streams[k] for k in sorted(resources.streams.keys())},
        "mappings": {k: resources.mappings[k] for k in sorted(resources.mappings.keys())},
        "enrichments": {k: resources.enrichments[k] for k in sorted(resources.enrichments.keys())},
        "requires": _requires_snapshot(manifest),
        "capabilities": dict(manifest.capabilities or {}),
    }


def _get_installed_row(db: Session, package_id: str) -> MarketplacePackageInstall:
    row = db.query(MarketplacePackageInstall).filter(MarketplacePackageInstall.package_id == package_id).first()
    if row is None or row.status != LIFECYCLE_STATUS_INSTALLED:
        raise LifecycleError(
            f"package not installed: {package_id}",
            error_code="PACKAGE_NOT_INSTALLED",
        )
    return row


def _affected_runtime(db: Session, package_id: str) -> UpgradeImpactAffected:
    streams = streams_depending_on_package(db, package_id)
    if not streams:
        return UpgradeImpactAffected()

    stream_ids = [int(s.id) for s in streams]
    routes = (
        db.query(Route)
        .options(joinedload(Route.stream))
        .filter(Route.stream_id.in_(stream_ids))
        .all()
    )
    dest_ids = {int(r.destination_id) for r in routes}
    destinations = (
        db.query(Destination).filter(Destination.id.in_(dest_ids)).all() if dest_ids else []
    )

    affected_streams: list[UpgradeImpactAffectedStream] = []
    for stream in streams:
        cfg = dict(stream.config_json or {})
        provenance = cfg.get(PROVENANCE_CONFIG_KEY)
        pack_version = None
        if isinstance(provenance, dict):
            pack_version = str(provenance.get("pack_version") or "") or None
        affected_streams.append(
            UpgradeImpactAffectedStream(
                id=int(stream.id),
                name=str(stream.name or ""),
                status=str(stream.status or ""),
                pack_version=pack_version,
            )
        )

    return UpgradeImpactAffected(
        streams=affected_streams,
        routes=[
            UpgradeImpactAffectedRoute(
                id=int(r.id),
                stream_id=int(r.stream_id),
                destination_id=int(r.destination_id),
                enabled=bool(r.enabled),
            )
            for r in routes
        ],
        destinations=[
            UpgradeImpactAffectedDestination(id=int(d.id), name=str(d.name or ""))
            for d in destinations
        ],
    )


def _classify_diff(
    *,
    changes: list[dict[str, Any]],
    current_snap: dict[str, Any],
    proposed_snap: dict[str, Any],
    affected: UpgradeImpactAffected,
) -> tuple[
    list[UpgradeImpactFieldChange],
    list[UpgradeImpactIssue],
    list[UpgradeImpactIssue],
    list[UpgradeImpactRecommendation],
    list[str],
    list[str],
]:
    field_changes = [
        UpgradeImpactFieldChange(
            path=str(c.get("path") or ""),
            change=c.get("change") or "modified",  # type: ignore[arg-type]
            old=c.get("old"),
            new=c.get("new"),
        )
        for c in changes
    ]

    warnings: list[UpgradeImpactIssue] = []
    blocking: list[UpgradeImpactIssue] = []
    recommendations: list[UpgradeImpactRecommendation] = []

    current_ids = set(current_snap.get("stream_ids") or [])
    proposed_ids = set(proposed_snap.get("stream_ids") or [])
    added = sorted(proposed_ids - current_ids)
    removed = sorted(current_ids - proposed_ids)

    if current_snap.get("auth") != proposed_snap.get("auth"):
        warnings.append(
            _issue(
                "AUTH_CHANGE",
                "Package authentication contract changed. Re-test credentials before enabling streams.",
                path="auth",
            )
        )
        recommendations.append(
            UpgradeImpactRecommendation(id="test_connection", label="Test connection with existing credentials")
        )

    if current_snap.get("api_version") != proposed_snap.get("api_version"):
        warnings.append(
            _issue(
                "API_VERSION_CHANGE",
                "Vendor API version changed between installed and candidate packages.",
                path="api_version",
            )
        )

    if added:
        warnings.append(
            _issue(
                "STREAMS_ADDED",
                f"New package stream(s) available: {', '.join(added)}. Create streams explicitly if needed.",
                path="streams",
            )
        )
    if removed:
        warnings.append(
            _issue(
                "STREAMS_REMOVED",
                f"Package stream(s) removed from catalog: {', '.join(removed)}. Running Stream configs are not mutated.",
                path="streams",
            )
        )
        recommendations.append(
            UpgradeImpactRecommendation(
                id="review_removed_streams",
                label="Review streams that referenced removed package stream templates",
            )
        )

    mapping_changed = any(
        (c.get("path") or "").startswith("mappings") or (c.get("path") or "").startswith("stream_templates")
        for c in changes
    )
    if mapping_changed:
        warnings.append(
            _issue(
                "SCHEMA_OR_MAPPING_CHANGE",
                "Schema/stream template or mapping resources changed. Review mappings before applying to streams.",
                path="mappings",
            )
        )
        recommendations.append(
            UpgradeImpactRecommendation(id="preview_sample", label="Fetch sample and validate mapping after upgrade")
        )

    if current_snap.get("requires") != proposed_snap.get("requires"):
        warnings.append(
            _issue(
                "DEPENDENCY_CHANGE",
                "Package dependency requirements changed.",
                path="requires",
            )
        )

    running = [s.name or str(s.id) for s in affected.streams if str(s.status or "").upper() == "RUNNING"]
    if running:
        warnings.append(
            _issue(
                "RUNNING_DEPENDENT_STREAMS",
                f"Dependent stream(s) are RUNNING: {', '.join(running)}. Catalog upgrade does not rewrite Stream config.",
            )
        )
        recommendations.append(
            UpgradeImpactRecommendation(id="canary", label="Prefer canary on a stopped stream before broad enablement")
        )

    if not recommendations:
        recommendations.append(
            UpgradeImpactRecommendation(id="verify_after_upgrade", label="Verify connector health after upgrade")
        )

    return field_changes, blocking, warnings, recommendations, added, removed


def preview_package_upgrade_impact(
    db: Session,
    package_id: str,
    archive: bytes | BinaryIO,
    *,
    base_digest: str | None = None,
    base_updated_at: datetime | None = None,
    builtin_root: Path | None = None,
    installed_root: Path | None = None,
) -> UpgradeImpactPreviewResponse:
    """Compare installed vs candidate package. Never publishes or mutates lifecycle rows."""

    installed_root = installed_root if installed_root is not None else installed_plugins_root()
    package_id = package_id.strip()
    staged: StagedPackage | None = None

    try:
        row = _get_installed_row(db, package_id)
        current_updated_at = _utc_aware(row.updated_at)  # type: ignore[arg-type]

        staged = _stage_from_upload(archive, installed_root=installed_root)
        test_checks: list[str] = ["archive_staged", "manifest_parsed", "secret_scan"]

        if staged.package_id != package_id:
            raise LifecycleError(
                (
                    f"upgrade package_id mismatch: expected {package_id!r}, "
                    f"archive has {staged.package_id!r}"
                ),
                error_code="PACKAGE_ID_MISMATCH",
            )

        blocking: list[UpgradeImpactIssue] = []
        warnings: list[UpgradeImpactIssue] = []

        if staged.pack_version == row.pack_version:
            blocking.append(
                _issue(
                    "SAME_VERSION",
                    f"Candidate pack_version matches installed ({row.pack_version!r}).",
                    severity="blocking",
                    path="pack_version",
                )
            )

        sig = verify_package_signature(
            db,
            canonical_digest=staged.digest,
            metadata=staged.signature_metadata,
        )
        test_checks.append(f"signature:{sig.status}")
        if sig.status not in (SIGNATURE_STATUS_VALID, SIGNATURE_STATUS_UNSIGNED):
            blocking.append(
                _issue(
                    "PACKAGE_SIGNATURE_INVALID",
                    f"Package signature status is {sig.status}.",
                    severity="blocking",
                )
            )

        available = _available_package_versions(
            db,
            builtin_root=builtin_root,
            installed_root=installed_root,
        )
        try:
            validate_package_dependencies(staged.manifest, available_versions=available)
            test_checks.append("dependencies_ok")
        except LifecycleError as exc:
            blocking.append(
                _issue(exc.error_code, exc.message, severity="blocking", path="requires")
            )
            test_checks.append(f"dependencies_failed:{exc.error_code}")

        active = active_package_path(package_id, installed_root=installed_root)
        if not active.is_dir():
            raise LifecycleError(
                f"active package path missing for {package_id}",
                error_code="PACKAGE_NOT_INSTALLED",
            )

        current_manifest = _load_manifest_from_dir(active)
        current_snap = _package_snapshot(manifest=current_manifest, package_root=active)
        proposed_snap = _package_snapshot(manifest=staged.manifest, package_root=staged.package_root)

        raw_diff = diff_json(current_snap, proposed_snap)
        affected = _affected_runtime(db, package_id)
        field_changes, class_blocking, class_warnings, recommendations, added, removed = _classify_diff(
            changes=raw_diff,
            current_snap=current_snap,
            proposed_snap=proposed_snap,
            affected=affected,
        )
        blocking.extend(class_blocking)
        warnings.extend(class_warnings)
        affected.stream_ids_added = added
        affected.stream_ids_removed = removed

        stale_base = False
        if base_digest is not None and base_digest.strip() and base_digest.strip() != row.digest:
            stale_base = True
            blocking.append(
                _issue(
                    "STALE_PACKAGE_BASE",
                    "Installed package digest changed since preview started. Re-run impact preview.",
                    severity="blocking",
                )
            )
        if base_updated_at is not None and current_updated_at is not None:
            if not _ts_equal(base_updated_at, current_updated_at):
                stale_base = True
                blocking.append(
                    _issue(
                        "STALE_PACKAGE_BASE",
                        "Installed package was updated by another session. Re-run impact preview.",
                        severity="blocking",
                    )
                )

        has_changes = len(field_changes) > 0 or staged.pack_version != row.pack_version
        can_upgrade = len(blocking) == 0 and has_changes

        test_status: str = "PASS"
        if blocking:
            test_status = "FAIL"
        elif warnings:
            test_status = "WARNING"

        test = UpgradeImpactTestResult(
            status=test_status,  # type: ignore[arg-type]
            summary=(
                "Candidate package passed static validation."
                if test_status == "PASS"
                else (
                    "Candidate package has blocking validation issues."
                    if test_status == "FAIL"
                    else "Candidate package validated with warnings."
                )
            ),
            checks=test_checks,
        )

        running_count = sum(1 for s in affected.streams if str(s.status or "").upper() == "RUNNING")
        runtime_impact = (
            f"Catalog upgrade from {row.pack_version} → {staged.pack_version}; "
            f"{len(affected.streams)} provenance-linked stream(s), {len(affected.routes)} route(s)."
        )
        delivery_impact = (
            f"{running_count} running stream(s) keep their current Stream configuration "
            "(upgrade does not mutate runtime stream config, checkpoints, or schema baselines)."
        )

        if not has_changes and not blocking:
            can_upgrade = False
            recommendations = [
                UpgradeImpactRecommendation(id="no_change", label="No package differences to apply")
            ]

        return UpgradeImpactPreviewResponse(
            package_id=package_id,
            current_pack_version=row.pack_version,
            proposed_pack_version=staged.pack_version,
            current_digest=row.digest,
            proposed_digest=staged.digest,
            current_updated_at=current_updated_at,
            has_changes=has_changes,
            changed_fields=field_changes,
            affected=affected,
            test=test,
            blocking_issues=blocking,
            warnings=warnings,
            can_upgrade=can_upgrade,
            can_apply=can_upgrade,
            recommended_actions=recommendations,
            preview_only=True,
            stale_base=stale_base,
            runtime_impact=runtime_impact,
            delivery_impact=delivery_impact,
            schema_baseline_unchanged=True,
            checkpoint_unchanged=True,
            stream_config_unchanged=True,
        )
    finally:
        if staged is not None:
            cleanup_staging(staged)
