"""Environment Promotion service — GitOps bundles + preview/apply via existing import paths.

Preview is read-only (import dry-run + config diff). Apply reuses ``backup.service.apply_import``.
Never copies checkpoints or credential plaintext. No new deployment/runtime engine.
"""

from __future__ import annotations

import copy
import hashlib
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.backup.export_builder import build_workspace_export, canonical_bundle_json
from app.backup.export_validation import verify_export_masking
from app.backup.import_validator import preview_token_for
from app.backup.schemas import ImportApplyRequest
from app.backup.service import apply_import, preview_import
from app.connectors.models import Connector
from app.destinations.models import Destination
from app.environment_promotion.schemas import (
    EnvironmentName,
    PromotionAffected,
    PromotionAffectedEntity,
    PromotionApplyRequest,
    PromotionApplyResponse,
    PromotionExportRequest,
    PromotionExportResponse,
    PromotionFieldChange,
    PromotionIssue,
    PromotionPreviewRequest,
    PromotionPreviewResponse,
)
from app.platform_admin import journal
from app.platform_admin.config_json_diff import diff_json
from app.routes.models import Route
from app.streams.models import Stream

_COMPARE_STREAM_KEYS = (
    "name",
    "enabled",
    "polling_interval",
    "config_json",
    "rate_limit_json",
    "stream_type",
)
_COMPARE_DEST_KEYS = ("name", "destination_type", "enabled", "config_json", "rate_limit_json")
_COMPARE_CONNECTOR_KEYS = ("name", "product_group", "description", "status")


class PromotionError(Exception):
    def __init__(self, *, error_code: str, message: str, http_status: int) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.message = message
        self.http_status = http_status


def _issue(code: str, message: str, *, severity: str = "warning", path: str | None = None) -> PromotionIssue:
    return PromotionIssue(code=code, message=message, severity=severity, path=path)  # type: ignore[arg-type]


def _strip_promotion_bundle(bundle: dict[str, Any]) -> dict[str, Any]:
    """Promotion never carries checkpoints or volatile export envelope noise into apply."""

    cleaned = copy.deepcopy(bundle)
    cleaned["checkpoints"] = []
    options = dict(cleaned.get("export_options") or {})
    options["include_checkpoints"] = False
    options["promotion_bundle"] = True
    cleaned["export_options"] = options
    meta = dict(cleaned.get("promotion") or {})
    meta["checkpoints_excluded"] = True
    meta["secrets_excluded"] = True
    cleaned["promotion"] = meta
    return cleaned


def _assert_no_secret_plaintext(bundle: dict[str, Any]) -> list[PromotionIssue]:
    leaks = verify_export_masking(bundle)
    return [
        _issue(
            "SECRET_PLAINTEXT_IN_BUNDLE",
            f"Promotion bundle must not include credential plaintext: {msg}",
            severity="blocking",
        )
        for msg in leaks
    ]


def compute_target_fingerprint(db: Session) -> str:
    """Stable hash of current non-secret configuration (no checkpoints)."""

    snap = build_workspace_export(db, include_checkpoints=False, include_destinations=True)
    identity = {k: v for k, v in snap.items() if k not in ("exported_at", "export_integrity")}
    raw = canonical_bundle_json(identity)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def promotion_token_for(
    *,
    bundle: dict[str, Any],
    mode: str,
    source_environment: str,
    target_environment: str,
    target_fingerprint: str,
) -> str:
    omit = frozenset({"export_integrity", "exported_at"})
    identity = {k: v for k, v in bundle.items() if k not in omit}
    payload = (
        f"{canonical_bundle_json(identity)}|{mode}|{source_environment}|{target_environment}|{target_fingerprint}"
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_promotion_export(db: Session, body: PromotionExportRequest) -> PromotionExportResponse:
    bundle = build_workspace_export(
        db,
        include_checkpoints=False,
        include_destinations=bool(body.include_destinations),
    )
    bundle = _strip_promotion_bundle(bundle)
    bundle["promotion"] = {
        "source_environment": body.source_environment,
        "gitops": True,
        "secrets_excluded": True,
        "checkpoints_excluded": True,
        "runtime_is_truth": True,
    }
    leaks = _assert_no_secret_plaintext(bundle)
    if leaks:
        raise PromotionError(
            error_code="SECRET_PLAINTEXT_IN_BUNDLE",
            message=leaks[0].message,
            http_status=500,
        )
    fingerprint = compute_target_fingerprint(db)
    return PromotionExportResponse(
        source_environment=body.source_environment,
        bundle=bundle,
        secrets_excluded=True,
        checkpoints_excluded=True,
        target_fingerprint=fingerprint,
    )


def _stream_compare_doc(row: Stream | dict[str, Any]) -> dict[str, Any]:
    if isinstance(row, Stream):
        return {
            "name": row.name,
            "enabled": bool(row.enabled),
            "polling_interval": int(row.polling_interval or 60),
            "config_json": dict(row.config_json or {}),
            "rate_limit_json": dict(row.rate_limit_json or {}),
            "stream_type": row.stream_type,
        }
    return {k: copy.deepcopy(row.get(k)) for k in _COMPARE_STREAM_KEYS}


def _dest_compare_doc(row: Destination | dict[str, Any]) -> dict[str, Any]:
    if isinstance(row, Destination):
        return {
            "name": row.name,
            "destination_type": row.destination_type,
            "enabled": bool(row.enabled),
            "config_json": dict(row.config_json or {}),
            "rate_limit_json": dict(row.rate_limit_json or {}),
        }
    return {k: copy.deepcopy(row.get(k)) for k in _COMPARE_DEST_KEYS}


def _connector_compare_doc(row: Connector | dict[str, Any]) -> dict[str, Any]:
    if isinstance(row, Connector):
        return {
            "name": row.name,
            "product_group": row.product_group,
            "description": row.description,
            "status": row.status,
        }
    return {k: copy.deepcopy(row.get(k)) for k in _COMPARE_CONNECTOR_KEYS}


def _diff_named_entities(
    *,
    entity_type: str,
    source_rows: list[dict[str, Any]],
    target_by_name: dict[str, Any],
    doc_fn: Any,
) -> tuple[list[PromotionFieldChange], list[PromotionAffectedEntity], int]:
    changes: list[PromotionFieldChange] = []
    affected: list[PromotionAffectedEntity] = []
    create_count = 0
    for raw in source_rows:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name:
            continue
        target = target_by_name.get(name)
        if target is None:
            create_count += 1
            affected.append(
                PromotionAffectedEntity(
                    entity_type=entity_type,
                    id=None,
                    name=name,
                    action="create",
                )
            )
            changes.append(
                PromotionFieldChange(
                    entity_type=entity_type,
                    entity_name=name,
                    path="(new)",
                    change="added",
                    old=None,
                    new=name,
                )
            )
            continue
        before = doc_fn(target)
        after = doc_fn(raw)
        raw_diff = diff_json(before, after)
        if not raw_diff:
            continue
        tid = int(target.id) if hasattr(target, "id") else None
        status = str(getattr(target, "status", None) or "") or None
        affected.append(
            PromotionAffectedEntity(
                entity_type=entity_type,
                id=tid,
                name=name,
                status=status,
                action="compare",
            )
        )
        for item in raw_diff:
            changes.append(
                PromotionFieldChange(
                    entity_type=entity_type,
                    entity_name=name,
                    path=str(item.get("path") or ""),
                    change=item["change"],  # type: ignore[arg-type]
                    old=item.get("old"),
                    new=item.get("new"),
                )
            )
    return changes, affected, create_count


def preview_promotion(db: Session, body: PromotionPreviewRequest) -> PromotionPreviewResponse:
    bundle = _strip_promotion_bundle(body.bundle if isinstance(body.bundle, dict) else {})
    fingerprint = compute_target_fingerprint(db)
    blocking: list[PromotionIssue] = []
    warnings: list[PromotionIssue] = []

    blocking.extend(_assert_no_secret_plaintext(bundle))

    if body.bundle.get("checkpoints"):
        warnings.append(
            _issue(
                "CHECKPOINTS_STRIPPED",
                "Checkpoints were present in the source bundle and were excluded from promotion.",
            )
        )

    if body.source_environment == body.target_environment:
        warnings.append(
            _issue(
                "SAME_ENVIRONMENT_LABEL",
                "Source and target environment labels match; confirm this deployment is the intended target.",
            )
        )

    stale = False
    if body.target_fingerprint and body.target_fingerprint != fingerprint:
        stale = True
        blocking.append(
            _issue(
                "STALE_TARGET",
                "Target configuration changed since this promotion preview. Re-run preview before apply.",
                severity="blocking",
            )
        )

    import_preview = preview_import(db, bundle, body.mode, dry_run=True)
    for c in import_preview.conflicts:
        blocking.append(_issue(c.code, c.message, severity="blocking"))
    for w in import_preview.warnings:
        warnings.append(_issue(w.code, w.message, severity="warning"))
    for f in import_preview.findings:
        if f.classification == "blocked":
            blocking.append(_issue(f.code, f.message, severity="blocking"))
        elif f.classification == "overwrite_candidate":
            warnings.append(_issue(f.code, f.message, severity="warning"))

    connectors = [c for c in (bundle.get("connectors") or []) if isinstance(c, dict)]
    streams = [s for s in (bundle.get("streams") or []) if isinstance(s, dict)]
    destinations = [d for d in (bundle.get("destinations") or []) if isinstance(d, dict)]
    routes = [r for r in (bundle.get("routes") or []) if isinstance(r, dict)]

    target_connectors = {str(c.name): c for c in db.query(Connector).all() if c.name}
    target_streams = {str(s.name): s for s in db.query(Stream).all() if s.name}
    target_destinations = {str(d.name): d for d in db.query(Destination).all() if d.name}

    changes: list[PromotionFieldChange] = []
    affected_entities: list[PromotionAffectedEntity] = []

    c_changes, c_aff, _ = _diff_named_entities(
        entity_type="connector",
        source_rows=connectors,
        target_by_name=target_connectors,
        doc_fn=_connector_compare_doc,
    )
    s_changes, s_aff, _ = _diff_named_entities(
        entity_type="stream",
        source_rows=streams,
        target_by_name=target_streams,
        doc_fn=_stream_compare_doc,
    )
    d_changes, d_aff, _ = _diff_named_entities(
        entity_type="destination",
        source_rows=destinations,
        target_by_name=target_destinations,
        doc_fn=_dest_compare_doc,
    )
    changes.extend(c_changes)
    changes.extend(s_changes)
    changes.extend(d_changes)
    affected_entities.extend(c_aff)
    affected_entities.extend(s_aff)
    affected_entities.extend(d_aff)

    # Routes: count as affected when parent stream is in source bundle
    stream_names = {str(s.get("name") or "") for s in streams}
    for r in routes:
        sid = r.get("stream_id")
        # Resolve stream name from bundle
        stream_name = next(
            (str(s.get("name") or "") for s in streams if s.get("id") == sid),
            f"stream:{sid}",
        )
        if stream_name in stream_names or stream_name:
            matched = target_streams.get(stream_name)
            affected_entities.append(
                PromotionAffectedEntity(
                    entity_type="route",
                    id=int(r["id"]) if r.get("id") is not None else None,
                    name=f"route→{stream_name}",
                    status=str(matched.status) if matched is not None else None,
                    action="create" if matched is None else "compare",
                )
            )

    running = (
        db.query(Stream)
        .filter(Stream.status == "RUNNING")
        .all()
    )
    if body.mode == "full_restore" and running:
        names = ", ".join(str(s.name or s.id) for s in running[:8])
        blocking.append(
            _issue(
                "RUNNING_STREAMS_BLOCK_RESTORE",
                f"Stop running streams before full-restore promotion: {names}",
                severity="blocking",
            )
        )
    elif body.mode == "additive" and running and changes:
        warnings.append(
            _issue(
                "TARGET_HAS_RUNNING_STREAMS",
                "Target has running streams. Additive promotion creates new entities and does not mutate running config.",
            )
        )

    # Deduplicate blocking by code+message
    seen_b: set[tuple[str, str]] = set()
    uniq_blocking: list[PromotionIssue] = []
    for b in blocking:
        key = (b.code, b.message)
        if key in seen_b:
            continue
        seen_b.add(key)
        uniq_blocking.append(b)

    seen_w: set[tuple[str, str]] = set()
    uniq_warnings: list[PromotionIssue] = []
    for w in warnings:
        key = (w.code, w.message)
        if key in seen_w:
            continue
        seen_w.add(key)
        uniq_warnings.append(w)

    safe_create = int(import_preview.classification_summary.safe_create or 0)
    has_changes = bool(changes) or safe_create > 0
    if body.mode == "full_restore" and (connectors or streams or destinations):
        # Full-restore promotion is always a material apply when the bundle has entities.
        has_changes = True

    can_promote = len(uniq_blocking) == 0 and bool(import_preview.ok) and not stale
    if not has_changes and can_promote:
        warnings.append(
            _issue(
                "NO_CONFIGURATION_DIFF",
                "Source and target configuration appear aligned for compared entities.",
            )
        )

    token = promotion_token_for(
        bundle=bundle,
        mode=body.mode,
        source_environment=body.source_environment,
        target_environment=body.target_environment,
        target_fingerprint=fingerprint,
    )

    affected = PromotionAffected(
        entities=affected_entities,
        streams=sum(1 for e in affected_entities if e.entity_type == "stream"),
        routes=sum(1 for e in affected_entities if e.entity_type == "route"),
        destinations=sum(1 for e in affected_entities if e.entity_type == "destination"),
        connectors=sum(1 for e in affected_entities if e.entity_type == "connector"),
    )

    return PromotionPreviewResponse(
        source_environment=body.source_environment,
        target_environment=body.target_environment,
        mode=body.mode,
        target_fingerprint=fingerprint,
        promotion_token=token,
        has_changes=has_changes,
        changed_fields=changes[:200],
        affected=affected,
        blocking_issues=uniq_blocking,
        warnings=uniq_warnings,
        can_promote=can_promote,
        preview_only=True,
        stale_target=stale,
        secrets_excluded=True,
        checkpoints_excluded=True,
        import_ok=import_preview.ok,
        entity_counts=dict(import_preview.counts.model_dump()),
    )


def apply_promotion(
    db: Session,
    body: PromotionApplyRequest,
    *,
    request: Request | None = None,
) -> PromotionApplyResponse:
    preview_body = PromotionPreviewRequest(
        source_environment=body.source_environment,
        target_environment=body.target_environment,
        bundle=body.bundle,
        mode=body.mode,
        target_fingerprint=body.target_fingerprint,
    )
    preview = preview_promotion(db, preview_body)

    if preview.stale_target or body.target_fingerprint != preview.target_fingerprint:
        raise PromotionError(
            error_code="STALE_TARGET",
            message="Target configuration changed since preview. Re-run promotion preview.",
            http_status=409,
        )

    expected = promotion_token_for(
        bundle=_strip_promotion_bundle(body.bundle if isinstance(body.bundle, dict) else {}),
        mode=body.mode,
        source_environment=body.source_environment,
        target_environment=body.target_environment,
        target_fingerprint=preview.target_fingerprint,
    )
    if not body.promotion_token or body.promotion_token != expected:
        raise PromotionError(
            error_code="PROMOTION_TOKEN_MISMATCH",
            message="Call /promotion/preview first and pass the returned promotion_token.",
            http_status=400,
        )

    if not preview.can_promote:
        code = preview.blocking_issues[0].code if preview.blocking_issues else "PROMOTION_BLOCKED"
        msg = preview.blocking_issues[0].message if preview.blocking_issues else "Promotion is blocked."
        raise PromotionError(error_code=code, message=msg, http_status=409)

    if not preview.has_changes:
        return PromotionApplyResponse(
            applied=False,
            no_op=True,
            source_environment=body.source_environment,
            target_environment=body.target_environment,
            mode=body.mode,
            preview=preview,
        )

    if not body.confirm:
        raise PromotionError(
            error_code="PROMOTION_CONFIRM_REQUIRED",
            message="Set confirm=true after reviewing the promotion preview.",
            http_status=400,
        )

    if body.mode == "full_restore" and not body.confirm_destructive:
        raise PromotionError(
            error_code="PROMOTION_DESTRUCTIVE_CONFIRM_REQUIRED",
            message="Set confirm_destructive=true for full-restore promotion.",
            http_status=400,
        )

    cleaned = _strip_promotion_bundle(body.bundle)
    # Reuse import preview_token contract for apply_import
    import_token = preview_token_for(cleaned, body.mode)
    apply_body = ImportApplyRequest(
        bundle=cleaned,
        mode=body.mode,
        confirm=True,
        confirm_destructive=bool(body.confirm_destructive) if body.mode == "full_restore" else False,
        preview_token=import_token,
    )
    result = apply_import(db, apply_body)

    journal.record_audit_event(
        db,
        action="ENVIRONMENT_PROMOTION_APPLIED",
        entity_type="environment_promotion",
        entity_id=None,
        details={
            "source_environment": body.source_environment,
            "target_environment": body.target_environment,
            "mode": body.mode,
            "connectors_created": len(result.created.connector_ids),
            "streams_created": len(result.created.stream_ids),
            "destinations_created": len(result.created.destination_ids),
            "target_fingerprint_before": body.target_fingerprint,
        },
        request=request,
    )
    db.commit()

    return PromotionApplyResponse(
        applied=True,
        no_op=False,
        source_environment=body.source_environment,
        target_environment=body.target_environment,
        mode=body.mode,
        created_connector_ids=list(result.created.connector_ids),
        created_stream_ids=list(result.created.stream_ids),
        created_destination_ids=list(result.created.destination_ids),
        redirect_path=result.redirect_path,
        preview=preview,
    )
