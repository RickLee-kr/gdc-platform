"""Service entrypoints for dynamic routing (M9)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.dynamic_routing.dynamic_routing_engine import DynamicRoutingBatchResult, evaluate_batch
from app.sensitive_detection.context import SensitiveDetectionContext, findings_from_context
from app.dynamic_routing.dynamic_routing_metrics import (
    build_dynamic_routing_complete_payload,
    load_cumulative_dynamic_delivery_totals,
)
from app.routes.models import Route


def base_enabled_destination_ids(db: Session, stream_id: int) -> set[int]:
    """Enabled base-route destination ids (for duplicate suppression)."""

    routes = (
        db.query(Route)
        .options(joinedload(Route.destination))
        .filter(Route.stream_id == int(stream_id), Route.enabled.is_(True))
        .order_by(Route.id.asc())
        .all()
    )
    ids: set[int] = set()
    for route in routes:
        dest = route.destination
        if dest is not None and bool(dest.enabled):
            ids.add(int(dest.id))
    return ids


def resolve_selected_destination_names(
    db: Session | None,
    *,
    stream_id: int,
    enriched_events: list[dict[str, Any]],
    batch_result: DynamicRoutingBatchResult | None = None,
    findings: list[dict[str, Any]] | None = None,
) -> list[str]:
    """Base route destinations + additive dynamic destinations (deduped by destination id)."""

    if db is None:
        return []

    base_names: list[str] = []
    seen_names: set[str] = set()
    base_dest_ids = base_enabled_destination_ids(db, stream_id)
    routes = (
        db.query(Route)
        .options(joinedload(Route.destination))
        .filter(Route.stream_id == int(stream_id), Route.enabled.is_(True))
        .order_by(Route.id.asc())
        .all()
    )
    for route in routes:
        dest = route.destination
        if dest is None or not bool(dest.enabled):
            continue
        name = str(dest.name)
        if name not in seen_names:
            seen_names.add(name)
            base_names.append(name)

    result = batch_result if batch_result is not None else evaluate_batch(
        db,
        stream_id=stream_id,
        events=enriched_events,
        findings=findings,
    )
    for match in result.matches:
        if not match.destination_enabled:
            continue
        if int(match.destination_id) in base_dest_ids:
            continue
        name = match.destination_name
        if name not in seen_names:
            seen_names.add(name)
            base_names.append(name)
    return base_names


def effective_selected_destination_count(
    db: Session | None,
    *,
    stream_id: int,
    enriched_events: list[dict[str, Any]],
    batch_result: DynamicRoutingBatchResult,
) -> int:
    return len(
        resolve_selected_destination_names(
            db,
            stream_id=stream_id,
            enriched_events=enriched_events,
            batch_result=batch_result,
        )
    )


def evaluate_dynamic_routes_for_delivery(
    db: Session | None,
    *,
    stream_id: int,
    enriched_events: list[dict[str, Any]],
    detection_context: SensitiveDetectionContext | None = None,
    findings: list[dict[str, Any]] | None = None,
) -> DynamicRoutingBatchResult:
    """Evaluate dynamic routes after policy; does not mutate events or emit logs."""

    shared_findings = findings if findings is not None else findings_from_context(detection_context)
    result = evaluate_batch(
        db,
        stream_id=stream_id,
        events=enriched_events,
        findings=shared_findings,
    )
    if db is not None and enriched_events:
        result.selected_destination_count = effective_selected_destination_count(
            db,
            stream_id=stream_id,
            enriched_events=enriched_events,
            batch_result=result,
        )
    return result


def log_dynamic_routing_complete(
    db: Session | None,
    *,
    stream_id: int,
    result: DynamicRoutingBatchResult,
    dynamic_deliveries_this_run: int,
    log_fn: Callable[[dict[str, Any]], None],
) -> None:
    cumulative = (
        load_cumulative_dynamic_delivery_totals(db, stream_id)
        if db is not None
        else {"dynamic_deliveries": 0, "matched_dynamic_routes": 0}
    )
    log_fn(
        build_dynamic_routing_complete_payload(
            stream_id=stream_id,
            result=result,
            dynamic_deliveries_this_run=max(0, int(dynamic_deliveries_this_run)),
            cumulative_totals=cumulative,
        )
    )


def evaluate_dynamic_routes_for_preview(
    db: Session | None,
    *,
    stream_id: int,
    enriched_events: list[dict[str, Any]],
    detection_context: SensitiveDetectionContext | None = None,
    findings: list[dict[str, Any]] | None = None,
    batch_result: DynamicRoutingBatchResult | None = None,
) -> list[str]:
    shared_findings = findings if findings is not None else findings_from_context(detection_context)
    if batch_result is not None:
        return resolve_selected_destination_names(
            db,
            stream_id=stream_id,
            enriched_events=enriched_events,
            batch_result=batch_result,
            findings=shared_findings,
        )
    return resolve_selected_destination_names(
        db,
        stream_id=stream_id,
        enriched_events=enriched_events,
        findings=shared_findings,
    )
