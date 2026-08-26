"""Safe Change impact analysis and apply via existing config persist paths.

Preview is read-only: no DB writes, no checkpoint/runtime mutations.
Apply reuses serialize/journal patterns from stream/route/destination routers
and the RUNNING guards from config snapshot apply.
"""

from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session, joinedload

from app.destinations.config_validation import validate_destination_config
from app.destinations.models import Destination
from app.mappings.models import Mapping
from app.security.secrets import preserve_masked_secrets
from app.platform_admin import journal
from app.platform_admin.config_entity_snapshots import (
    ENTITY_DESTINATION,
    ENTITY_MAPPING,
    ENTITY_ROUTE,
    ENTITY_STREAM,
    serialize_destination_config,
    serialize_mapping_for_stream,
    serialize_mapping_row,
    serialize_route_config,
    serialize_stream_config,
)
from app.platform_admin.config_json_diff import diff_json
from app.routes.models import Route
from app.safe_change.schemas import (
    SafeChangeAffected,
    SafeChangeAffectedDestination,
    SafeChangeAffectedRoute,
    SafeChangeAffectedStream,
    SafeChangeApplyResponse,
    SafeChangeFieldChange,
    SafeChangeIssue,
    SafeChangePreviewRequest,
    SafeChangePreviewResponse,
    SafeChangeRecommendation,
)
from app.streams.models import Stream

_AUTH_ENDPOINT_TOKENS = (
    "url",
    "host",
    "port",
    "auth",
    "token",
    "password",
    "credential",
    "api_key",
    "endpoint",
    "base_url",
    "webhook",
)
_SCHEMA_TOKENS = (
    "field_mappings",
    "event_array_path",
    "event_root_path",
    "mapping",
    "schema",
    "formatter",
)


class SafeChangeError(Exception):
    def __init__(self, *, error_code: str, message: str, http_status: int) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.message = message
        self.http_status = http_status


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


def _issue(code: str, message: str, *, severity: str = "warning", path: str | None = None) -> SafeChangeIssue:
    return SafeChangeIssue(code=code, message=message, severity=severity, path=path)  # type: ignore[arg-type]


def _path_matches(path: str, tokens: tuple[str, ...]) -> bool:
    lower = path.lower()
    return any(tok in lower for tok in tokens)


def _proposed_stream_snapshot(row: Stream, proposed: dict[str, Any]) -> dict[str, Any]:
    snap = serialize_stream_config(row)
    for key in ("name", "enabled", "polling_interval", "config_json", "rate_limit_json"):
        if key in proposed and proposed[key] is not None:
            snap[key] = copy.deepcopy(proposed[key]) if isinstance(proposed[key], dict) else proposed[key]
    return snap


def _proposed_route_snapshot(row: Route, proposed: dict[str, Any]) -> dict[str, Any]:
    snap = serialize_route_config(row)
    for key in (
        "stream_id",
        "destination_id",
        "enabled",
        "failure_policy",
        "formatter_config_json",
        "rate_limit_json",
        "status",
        "disable_reason",
    ):
        if key in proposed:
            val = proposed[key]
            snap[key] = copy.deepcopy(val) if isinstance(val, dict) else val
    return snap


def _proposed_destination_snapshot(row: Destination, proposed: dict[str, Any]) -> dict[str, Any]:
    snap = serialize_destination_config(row)
    for key in ("name", "destination_type", "enabled", "config_json", "rate_limit_json"):
        if key in proposed and proposed[key] is not None:
            snap[key] = copy.deepcopy(proposed[key]) if isinstance(proposed[key], dict) else proposed[key]
    if "config_json" in proposed and proposed["config_json"] is not None:
        snap["config_json"] = preserve_masked_secrets(
            dict(proposed["config_json"]),
            dict(row.config_json or {}),
        )
    return snap


def _proposed_mapping_snapshot(db: Session, stream_id: int, proposed: dict[str, Any]) -> dict[str, Any]:
    snap = serialize_mapping_for_stream(db, stream_id)
    for key in (
        "event_array_path",
        "event_root_path",
        "field_mappings_json",
        "raw_payload_mode",
    ):
        if key in proposed:
            val = proposed[key]
            snap[key] = copy.deepcopy(val) if isinstance(val, dict) else val
            snap["_absent"] = False
    return snap


def _affected_for_stream(db: Session, stream: Stream) -> SafeChangeAffected:
    routes = db.query(Route).filter(Route.stream_id == int(stream.id)).all()
    dest_ids = {int(r.destination_id) for r in routes}
    destinations = (
        db.query(Destination).filter(Destination.id.in_(dest_ids)).all() if dest_ids else []
    )
    return SafeChangeAffected(
        streams=[
            SafeChangeAffectedStream(
                id=int(stream.id),
                name=str(stream.name or ""),
                status=str(stream.status or ""),
            )
        ],
        routes=[
            SafeChangeAffectedRoute(
                id=int(r.id),
                stream_id=int(r.stream_id),
                destination_id=int(r.destination_id),
                enabled=bool(r.enabled),
            )
            for r in routes
        ],
        destinations=[
            SafeChangeAffectedDestination(id=int(d.id), name=str(d.name or "")) for d in destinations
        ],
    )


def _affected_for_route(db: Session, route: Route) -> SafeChangeAffected:
    stream = db.query(Stream).filter(Stream.id == int(route.stream_id)).first()
    dest = db.query(Destination).filter(Destination.id == int(route.destination_id)).first()
    return SafeChangeAffected(
        streams=(
            [
                SafeChangeAffectedStream(
                    id=int(stream.id),
                    name=str(stream.name or ""),
                    status=str(stream.status or ""),
                )
            ]
            if stream is not None
            else []
        ),
        routes=[
            SafeChangeAffectedRoute(
                id=int(route.id),
                stream_id=int(route.stream_id),
                destination_id=int(route.destination_id),
                enabled=bool(route.enabled),
            )
        ],
        destinations=(
            [SafeChangeAffectedDestination(id=int(dest.id), name=str(dest.name or ""))]
            if dest is not None
            else []
        ),
    )


def _affected_for_destination(db: Session, destination: Destination) -> SafeChangeAffected:
    routes = (
        db.query(Route)
        .options(joinedload(Route.stream))
        .filter(Route.destination_id == int(destination.id))
        .all()
    )
    streams: list[SafeChangeAffectedStream] = []
    seen: set[int] = set()
    for r in routes:
        sid = int(r.stream_id)
        if sid in seen:
            continue
        seen.add(sid)
        st = r.stream
        streams.append(
            SafeChangeAffectedStream(
                id=sid,
                name=str(st.name if st is not None else ""),
                status=str(st.status if st is not None else ""),
            )
        )
    return SafeChangeAffected(
        streams=streams,
        routes=[
            SafeChangeAffectedRoute(
                id=int(r.id),
                stream_id=int(r.stream_id),
                destination_id=int(r.destination_id),
                enabled=bool(r.enabled),
            )
            for r in routes
        ],
        destinations=[
            SafeChangeAffectedDestination(id=int(destination.id), name=str(destination.name or ""))
        ],
    )


def _running_stream_names(affected: SafeChangeAffected) -> list[str]:
    return [s.name or f"#{s.id}" for s in affected.streams if str(s.status or "") == "RUNNING"]


def _analyze_changes(
    *,
    entity_type: str,
    before: dict[str, Any],
    after: dict[str, Any],
    affected: SafeChangeAffected,
    validation_error: str | None = None,
) -> tuple[
    list[SafeChangeFieldChange],
    list[SafeChangeIssue],
    list[SafeChangeIssue],
    list[SafeChangeRecommendation],
    str,
    str,
]:
    raw_diff = diff_json(before, after)
    # Drop kind/id scaffolding noise that is not an operator "change"
    ignore_paths = {
        "kind",
        "stream_id",
        "route_id",
        "destination_id",
        "mapping_id",
        "_absent",
    }
    changes = [
        SafeChangeFieldChange(
            path=str(item["path"]),
            change=item["change"],  # type: ignore[arg-type]
            old=item.get("old"),
            new=item.get("new"),
        )
        for item in raw_diff
        if str(item.get("path") or "") not in ignore_paths
    ]

    blocking: list[SafeChangeIssue] = []
    warnings: list[SafeChangeIssue] = []
    recommendations: list[SafeChangeRecommendation] = []

    if validation_error:
        blocking.append(
            _issue(
                "INVALID_CONFIG",
                validation_error,
                severity="blocking",
            )
        )

    running = _running_stream_names(affected)
    auth_changes = [c for c in changes if _path_matches(c.path, _AUTH_ENDPOINT_TOKENS)]
    schema_changes = [c for c in changes if _path_matches(c.path, _SCHEMA_TOKENS)]
    enabled_changes = [c for c in changes if c.path.endswith("enabled") or c.path == "enabled"]

    if entity_type == ENTITY_DESTINATION and changes and running:
        # Matches config snapshot apply guard: do not mutate destination while streams run.
        blocking.append(
            _issue(
                "CONNECTED_STREAMS_RUNNING",
                "Stop connected running streams before applying destination configuration changes.",
                severity="blocking",
            )
        )

    if entity_type in {ENTITY_STREAM, ENTITY_MAPPING, ENTITY_ROUTE} and changes and running:
        warnings.append(
            _issue(
                "STREAM_RUNNING",
                "Affected stream(s) are running. Changes may affect in-flight delivery; prefer stop → apply → verify.",
            )
        )

    if auth_changes:
        warnings.append(
            _issue(
                "AUTH_OR_ENDPOINT_CHANGE",
                "Endpoint or authentication settings will change.",
                path=auth_changes[0].path,
            )
        )
        recommendations.append(
            SafeChangeRecommendation(id="test_connection", label="Test connection before apply")
        )

    if schema_changes:
        warnings.append(
            _issue(
                "SCHEMA_OR_MAPPING_CHANGE",
                "Schema, mapping, or formatter fields will change.",
                path=schema_changes[0].path,
            )
        )
        recommendations.append(
            SafeChangeRecommendation(id="preview_sample", label="Preview sample / mapping before apply")
        )

    if enabled_changes:
        warnings.append(
            _issue(
                "ENABLEMENT_CHANGE",
                "Enable/disable state will change and may alter delivery.",
                path=enabled_changes[0].path,
            )
        )

    if changes and running:
        recommendations.append(
            SafeChangeRecommendation(id="canary", label="Apply to a non-production or canary stream first when available")
        )
        recommendations.append(
            SafeChangeRecommendation(id="verify_after_apply", label="Verify delivery health after apply")
        )

    if entity_type in {ENTITY_STREAM, ENTITY_MAPPING, ENTITY_ROUTE, ENTITY_DESTINATION} and changes:
        recommendations.append(
            SafeChangeRecommendation(id="rollback_if_needed", label="Use configuration history to roll back if supported")
        )

    # Deduplicate recommendations by id
    seen_rec: set[str] = set()
    uniq_recs: list[SafeChangeRecommendation] = []
    for rec in recommendations:
        if rec.id in seen_rec:
            continue
        seen_rec.add(rec.id)
        uniq_recs.append(rec)

    if not changes:
        runtime_impact = "No configuration differences from the current saved state."
        delivery_impact = "No delivery impact."
    else:
        parts = [f"{len(changes)} field change(s)"]
        if affected.streams:
            parts.append(f"{len(affected.streams)} stream(s)")
        if affected.routes:
            parts.append(f"{len(affected.routes)} route(s)")
        if affected.destinations:
            parts.append(f"{len(affected.destinations)} destination(s)")
        runtime_impact = "Affects " + ", ".join(parts) + "."
        if running:
            delivery_impact = (
                f"Running stream(s) may be impacted: {', '.join(running)}."
            )
        elif any(r.enabled for r in affected.routes):
            delivery_impact = "Enabled routes may deliver differently after apply."
        else:
            delivery_impact = "No enabled routes currently delivering for this change."

    return changes, blocking, warnings, uniq_recs, runtime_impact, delivery_impact


def preview_safe_change(db: Session, body: SafeChangePreviewRequest) -> SafeChangePreviewResponse:
    """Compute read-only impact analysis. Must not mutate DB/runtime/checkpoints."""

    entity_type = body.entity_type
    entity_id = int(body.entity_id)
    proposed = dict(body.proposed or {})
    validation_error: str | None = None

    if entity_type == ENTITY_STREAM:
        row = db.query(Stream).filter(Stream.id == entity_id).first()
        if row is None:
            raise SafeChangeError(error_code="STREAM_NOT_FOUND", message=f"stream not found: {entity_id}", http_status=404)
        before = serialize_stream_config(row)
        after = _proposed_stream_snapshot(row, proposed)
        affected = _affected_for_stream(db, row)
        name = str(row.name or "")
        current_updated_at = _utc_aware(row.updated_at)  # type: ignore[arg-type]
    elif entity_type == ENTITY_ROUTE:
        row = db.query(Route).filter(Route.id == entity_id).first()
        if row is None:
            raise SafeChangeError(error_code="ROUTE_NOT_FOUND", message=f"route not found: {entity_id}", http_status=404)
        before = serialize_route_config(row)
        after = _proposed_route_snapshot(row, proposed)
        affected = _affected_for_route(db, row)
        stream = db.query(Stream).filter(Stream.id == int(row.stream_id)).first()
        name = str(stream.name) if stream is not None else f"route-{entity_id}"
        current_updated_at = _utc_aware(row.updated_at)  # type: ignore[arg-type]
    elif entity_type == ENTITY_DESTINATION:
        row = db.query(Destination).filter(Destination.id == entity_id).first()
        if row is None:
            raise SafeChangeError(
                error_code="DESTINATION_NOT_FOUND",
                message=f"destination not found: {entity_id}",
                http_status=404,
            )
        before = serialize_destination_config(row)
        after = _proposed_destination_snapshot(row, proposed)
        try:
            validate_destination_config(str(after["destination_type"]), dict(after.get("config_json") or {}))
        except ValueError as exc:
            validation_error = str(exc)
        affected = _affected_for_destination(db, row)
        name = str(row.name or "")
        current_updated_at = _utc_aware(row.updated_at)  # type: ignore[arg-type]
    elif entity_type == ENTITY_MAPPING:
        # entity_id is stream_id for mapping config (same as config-versions)
        stream = db.query(Stream).filter(Stream.id == entity_id).first()
        if stream is None:
            raise SafeChangeError(error_code="STREAM_NOT_FOUND", message=f"stream not found: {entity_id}", http_status=404)
        before = serialize_mapping_for_stream(db, entity_id)
        after = _proposed_mapping_snapshot(db, entity_id, proposed)
        affected = _affected_for_stream(db, stream)
        name = str(stream.name or "")
        mapping = db.query(Mapping).filter(Mapping.stream_id == entity_id).first()
        current_updated_at = _utc_aware(getattr(mapping, "updated_at", None) or stream.updated_at)  # type: ignore[arg-type]
    else:
        raise SafeChangeError(
            error_code="ENTITY_TYPE_UNSUPPORTED",
            message=f"unsupported entity_type: {entity_type}",
            http_status=400,
        )

    changes, blocking, warnings, recommendations, runtime_impact, delivery_impact = _analyze_changes(
        entity_type=entity_type,
        before=before,
        after=after,
        affected=affected,
        validation_error=validation_error,
    )

    stale_base = False
    if body.base_updated_at is not None and current_updated_at is not None:
        if not _ts_equal(body.base_updated_at, current_updated_at):
            stale_base = True
            blocking.append(
                _issue(
                    "STALE_CONFIGURATION",
                    "Configuration was changed by another session. Reload and review before applying.",
                    severity="blocking",
                )
            )

    has_changes = len(changes) > 0
    can_apply = len(blocking) == 0 and (has_changes or True)
    # No-op is allowed (can_apply true) when there are no blocking issues
    if not has_changes and not blocking:
        can_apply = True
        recommendations = [
            SafeChangeRecommendation(id="no_change", label="No changes to apply")
        ]

    if blocking:
        can_apply = False

    return SafeChangePreviewResponse(
        entity_type=entity_type,  # type: ignore[arg-type]
        entity_id=entity_id,
        entity_name=name,
        current_updated_at=current_updated_at,
        has_changes=has_changes,
        changed_fields=changes,
        affected=affected,
        runtime_impact=runtime_impact,
        delivery_impact=delivery_impact,
        blocking_issues=blocking,
        warnings=warnings,
        can_apply=can_apply,
        recommended_actions=recommendations,
        preview_only=True,
        stale_base=stale_base,
    )


def _persist_stream(db: Session, row: Stream, proposed: dict[str, Any], request: Request | None) -> int | None:
    before_snap = serialize_stream_config(row)
    update_keys: list[str] = []
    for key in ("name", "enabled", "polling_interval", "config_json", "rate_limit_json", "status", "connector_id", "source_id", "stream_type"):
        if key in proposed and proposed[key] is not None:
            setattr(row, key, proposed[key])
            update_keys.append(key)
    if not update_keys:
        return None
    after_snap = serialize_stream_config(row)
    journal.record_audit_event(
        db,
        action="STREAM_UPDATED",
        entity_type="STREAM",
        entity_id=int(row.id),
        entity_name=str(row.name),
        details={"updated_fields": sorted(update_keys), "via": "safe_change_apply"},
        request=request,
    )
    ver = journal.record_config_version(
        db,
        entity_type="STREAM_CONFIG",
        entity_id=int(row.id),
        entity_name=str(row.name),
        summary=f"Safe change apply: {','.join(sorted(update_keys))}",
        snapshot_before=before_snap,
        snapshot_after=after_snap,
    )
    return int(ver) if ver is not None else None


def _persist_route(db: Session, row: Route, proposed: dict[str, Any], request: Request | None) -> int | None:
    before_snap = serialize_route_config(row)
    update_keys: list[str] = []
    for key in (
        "stream_id",
        "destination_id",
        "enabled",
        "failure_policy",
        "formatter_config_json",
        "rate_limit_json",
        "status",
        "disable_reason",
    ):
        if key in proposed:
            setattr(row, key, proposed[key])
            update_keys.append(key)
    if not update_keys:
        return None
    stream = db.query(Stream).filter(Stream.id == int(row.stream_id)).first()
    stream_name = str(stream.name) if stream is not None else None
    journal.record_audit_event(
        db,
        action="ROUTE_UPDATED",
        entity_type="ROUTE",
        entity_id=int(row.id),
        entity_name=stream_name,
        details={"updated_fields": sorted(update_keys), "via": "safe_change_apply"},
        request=request,
    )
    ver = journal.record_config_version(
        db,
        entity_type="ROUTE_CONFIG",
        entity_id=int(row.id),
        entity_name=stream_name,
        summary=f"Safe change apply: {','.join(sorted(update_keys))}",
        snapshot_before=before_snap,
        snapshot_after=serialize_route_config(row),
    )
    return int(ver) if ver is not None else None


def _persist_destination(db: Session, row: Destination, proposed: dict[str, Any], request: Request | None) -> int | None:
    before_snap = serialize_destination_config(row)
    update = {k: proposed[k] for k in ("name", "destination_type", "enabled", "config_json", "rate_limit_json") if k in proposed}
    if "config_json" in update and update["config_json"] is not None:
        update["config_json"] = preserve_masked_secrets(dict(update["config_json"]), dict(row.config_json or {}))
    if not update:
        return None
    merged_type = str(update.get("destination_type", row.destination_type))
    merged_cfg = dict(update.get("config_json", row.config_json or {}))
    validate_destination_config(merged_type, merged_cfg)
    for key, value in update.items():
        if key in {"config_json", "rate_limit_json"} and value is not None:
            setattr(row, key, dict(value))
        else:
            setattr(row, key, value)
    journal.record_audit_event(
        db,
        action="DESTINATION_UPDATED",
        entity_type="DESTINATION",
        entity_id=int(row.id),
        entity_name=str(row.name),
        details={"updated_fields": sorted(update.keys()), "via": "safe_change_apply"},
        request=request,
    )
    ver = journal.record_config_version(
        db,
        entity_type="DESTINATION_CONFIG",
        entity_id=int(row.id),
        entity_name=str(row.name),
        summary=f"Safe change apply: {','.join(sorted(update.keys()))}",
        snapshot_before=before_snap,
        snapshot_after=serialize_destination_config(row),
    )
    return int(ver) if ver is not None else None


def _persist_mapping(db: Session, stream_id: int, proposed: dict[str, Any], request: Request | None) -> int | None:
    stream = db.query(Stream).filter(Stream.id == int(stream_id)).first()
    if stream is None:
        raise SafeChangeError(error_code="STREAM_NOT_FOUND", message=f"stream not found: {stream_id}", http_status=404)
    before_snap = serialize_mapping_for_stream(db, stream_id)
    mapping = db.query(Mapping).filter(Mapping.stream_id == int(stream_id)).first()
    update_keys: list[str] = []
    if mapping is None:
        mapping = Mapping(stream_id=int(stream_id))
        db.add(mapping)
        update_keys.append("created")
    for key in ("event_array_path", "event_root_path", "field_mappings_json", "raw_payload_mode"):
        if key in proposed:
            setattr(mapping, key, proposed[key])
            update_keys.append(key)
    if not update_keys:
        return None
    db.flush()
    journal.record_audit_event(
        db,
        action="MAPPING_UPDATED",
        entity_type="MAPPING",
        entity_id=int(mapping.id),
        entity_name=str(stream.name),
        details={"updated_fields": sorted(update_keys), "via": "safe_change_apply", "stream_id": stream_id},
        request=request,
    )
    ver = journal.record_config_version(
        db,
        entity_type="MAPPING_CONFIG",
        entity_id=int(stream_id),
        entity_name=str(stream.name),
        summary=f"Safe change apply: {','.join(sorted(update_keys))}",
        snapshot_before=before_snap,
        snapshot_after=serialize_mapping_row(mapping),
    )
    return int(ver) if ver is not None else None


def apply_safe_change(
    db: Session,
    body: SafeChangePreviewRequest,
    *,
    request: Request | None = None,
) -> SafeChangeApplyResponse:
    """Apply proposed config when preview says safe; uses existing journal/config-version path."""

    preview = preview_safe_change(db, body)
    if not preview.can_apply:
        code = preview.blocking_issues[0].code if preview.blocking_issues else "SAFE_CHANGE_BLOCKED"
        message = preview.blocking_issues[0].message if preview.blocking_issues else "Change is blocked."
        raise SafeChangeError(error_code=code, message=message, http_status=409)

    if not preview.has_changes:
        return SafeChangeApplyResponse(
            entity_type=body.entity_type,
            entity_id=int(body.entity_id),
            applied=False,
            no_op=True,
            config_version=None,
            updated_at=preview.current_updated_at,
            preview=preview,
        )

    proposed = dict(body.proposed or {})
    entity_type = body.entity_type
    entity_id = int(body.entity_id)
    version: int | None = None
    updated_at: datetime | None = None

    if entity_type == ENTITY_STREAM:
        row = db.query(Stream).filter(Stream.id == entity_id).first()
        assert row is not None
        version = _persist_stream(db, row, proposed, request)
        db.commit()
        db.refresh(row)
        updated_at = _utc_aware(row.updated_at)  # type: ignore[arg-type]
    elif entity_type == ENTITY_ROUTE:
        row = db.query(Route).filter(Route.id == entity_id).first()
        assert row is not None
        version = _persist_route(db, row, proposed, request)
        db.commit()
        db.refresh(row)
        updated_at = _utc_aware(row.updated_at)  # type: ignore[arg-type]
    elif entity_type == ENTITY_DESTINATION:
        row = db.query(Destination).filter(Destination.id == entity_id).first()
        assert row is not None
        version = _persist_destination(db, row, proposed, request)
        db.commit()
        db.refresh(row)
        updated_at = _utc_aware(row.updated_at)  # type: ignore[arg-type]
    elif entity_type == ENTITY_MAPPING:
        version = _persist_mapping(db, entity_id, proposed, request)
        db.commit()
        stream = db.query(Stream).filter(Stream.id == entity_id).first()
        updated_at = _utc_aware(stream.updated_at) if stream is not None else None  # type: ignore[arg-type]
    else:
        raise SafeChangeError(
            error_code="ENTITY_TYPE_UNSUPPORTED",
            message=f"unsupported entity_type: {entity_type}",
            http_status=400,
        )

    # Refresh preview after apply for response honesty (has_changes should be false if re-run)
    post = preview_safe_change(
        db,
        SafeChangePreviewRequest(
            entity_type=body.entity_type,
            entity_id=body.entity_id,
            proposed=proposed,
            base_updated_at=updated_at,
        ),
    )

    return SafeChangeApplyResponse(
        entity_type=body.entity_type,
        entity_id=entity_id,
        applied=True,
        no_op=False,
        config_version=version,
        updated_at=updated_at,
        preview=post.model_copy(update={"preview_only": False}),
    )
