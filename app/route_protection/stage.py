"""Route protection stage — reuses existing Protection Engine (M13.3)."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from app.protection.engine import ProtectBatchResult, protect_batch
from app.protection.metrics import build_protection_complete_payload, load_cumulative_protection_totals
from app.route_protection.resolver import merge_ephemeral_for_route, resolve_route_protection_config
from app.runners.route_context import RouteRuntimeContext, SharedBatchContext


LogFn = Callable[[dict[str, Any]], None]


def _audit_only_log_entries(
    *,
    stream_id: int,
    route_id: int,
    audit_only_paths: tuple[str, ...],
) -> list[dict[str, Any]]:
    return [
        {
            "stage": "protection",
            "stream_id": stream_id,
            "route_id": route_id,
            "field_path": path,
            "protection_mode": "audit_only",
            "message": "audit only — field not mutated",
            "status": "AUDIT_ONLY",
        }
        for path in audit_only_paths
    ]


def route_protection_stage(
    route_ctx: RouteRuntimeContext,
    shared_batch: SharedBatchContext,
    *,
    db: Session | None = None,
    log_fn: LogFn | None = None,
    stream_protection_rules: list[Any] | None = None,
    route_protection_rules: list[Any] | None = None,
    route_overrides: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], ProtectBatchResult, RouteProtectionConfig]:
    """Apply per-route protection using resolved config and shared ephemeral rules."""

    input_events = list(route_ctx.processing_state.current_events)
    protection_config = resolve_route_protection_config(
        route_id=route_ctx.route_id,
        stream_id=route_ctx.stream_id,
        route_protection_rules=route_protection_rules,
        stream_protection_rules=stream_protection_rules,
        route_overrides=route_overrides,
        ephemeral_auto_protect_rules=shared_batch.ephemeral_auto_protect_rules,
    )
    route_ctx.effective_config.protection = protection_config

    merged_ephemeral = merge_ephemeral_for_route(
        shared_batch.ephemeral_auto_protect_rules,
        protection_config,
    )

    started = time.monotonic()
    result = protect_batch(
        input_events,
        list(protection_config.rules),
        stream_id=route_ctx.stream_id,
        db=db,
        ephemeral_rules=merged_ephemeral or None,
    )
    duration_ms = max(0, int((time.monotonic() - started) * 1000))

    for warn in result.warnings:
        if log_fn is not None:
            log_fn(
                {
                    "stage": "protection",
                    "stream_id": route_ctx.stream_id,
                    "route_id": route_ctx.route_id,
                    "message": warn.error_message,
                    **warn.to_log_fields(),
                }
            )

    for audit_entry in _audit_only_log_entries(
        stream_id=route_ctx.stream_id,
        route_id=route_ctx.route_id,
        audit_only_paths=protection_config.audit_only_paths,
    ):
        if log_fn is not None:
            log_fn(audit_entry)

    if merged_ephemeral and log_fn is not None:
        for ephemeral in merged_ephemeral:
            log_fn(
                {
                    "stage": "schema_drift_policy_auto_protect_applied",
                    "stream_id": route_ctx.stream_id,
                    "route_id": route_ctx.route_id,
                    "field_path": str(getattr(ephemeral, "field_path", "")),
                    "protection_mode": str(getattr(ephemeral, "protection_mode", "")),
                    "message": "auto protect ephemeral rule applied",
                }
            )

    cumulative = {"total_protected_events": 0, "total_protected_fields": 0}
    if db is not None:
        cumulative = load_cumulative_protection_totals(db, route_ctx.stream_id)

    complete_payload = build_protection_complete_payload(
        stream_id=route_ctx.stream_id,
        result=result,
        enriched_event_count=len(input_events),
        cumulative_totals=cumulative,
    )
    complete_payload["route_id"] = route_ctx.route_id
    complete_payload["protection_source"] = protection_config.resolution.persisted_source
    complete_payload["override_count"] = protection_config.resolution.override_count
    complete_payload["ephemeral_rule_count"] = protection_config.resolution.ephemeral_rule_count
    if log_fn is not None:
        log_fn(complete_payload)

    return result.events, result, protection_config
