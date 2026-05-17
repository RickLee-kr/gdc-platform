"""Canonical observability summary read model."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Integer, case, cast, func, or_
from sqlalchemy.orm import Session

from app.destinations.models import Destination
from app.logs.models import DeliveryLog
from app.routes.models import Route
from app.runtime.health_service import get_health_overview
from app.runtime.metric_contract import metric_meta_map
from app.runtime.metrics_window import normalize_metrics_window_token, parse_metrics_window
from app.runtime.observability_metric_contract import (
    DELIVERY_FAILED_STAGES,
    DELIVERY_OUTCOME_STAGES,
    DELIVERY_SUCCESS_STAGES,
    KNOWN_OPERATIONAL_STAGES,
    METRIC_CONTRACT_VERSION,
    RETRY_FAILED_STAGES,
    RETRY_SUCCESS_STAGES,
    RUN_COMPLETE_STAGES,
    observability_metric_contract_payload,
)
from app.runtime.read_service import _dashboard_snapshot_id, _dashboard_snapshot_time
from app.runtime.schemas import ObservabilitySummaryResponse, ObservabilitySummaryTotals
from app.streams.models import Stream


def _event_count_expr():
    return func.greatest(
        1,
        func.coalesce(cast(DeliveryLog.payload_sample.op("->>")("event_count"), Integer), 1),
    )


def _input_events_expr():
    return func.greatest(
        0,
        func.coalesce(cast(DeliveryLog.payload_sample.op("->>")("input_events"), Integer), 0),
    )


def _is_warning_or_error_expr():
    return func.upper(func.coalesce(DeliveryLog.level, "")).in_(("WARN", "WARNING", "ERROR"))


def _lifecycle_row_expr():
    operational = tuple(sorted(KNOWN_OPERATIONAL_STAGES))
    return case(
        (
            DeliveryLog.stage.in_(operational),
            0,
        ),
        (
            _is_warning_or_error_expr(),
            0,
        ),
        else_=1,
    )


def get_observability_summary(
    db: Session,
    *,
    window: str = "24h",
    snapshot_id: str | None = None,
) -> ObservabilitySummaryResponse:
    """Build the shared top-level metrics snapshot for operations pages."""

    token = normalize_metrics_window_token(window)
    generated_at = _dashboard_snapshot_time(snapshot_id)
    resolved_snapshot_id = _dashboard_snapshot_id(generated_at)
    td = parse_metrics_window(token)
    start = generated_at - td
    end = generated_at
    seconds = max(1, int(td.total_seconds()))

    stream_row = (
        db.query(
            func.count(Stream.id).label("streams_total"),
            func.count(Stream.id).filter(Stream.status == "RUNNING").label("streams_running"),
        )
        .select_from(Stream)
        .one()
    )
    route_row = (
        db.query(
            func.count(Route.id).label("routes_total"),
            func.count(Route.id)
            .filter(Route.enabled.is_(True), or_(Destination.id.is_(None), Destination.enabled.is_(True)))
            .label("routes_enabled"),
        )
        .select_from(Route)
        .outerjoin(Destination, Destination.id == Route.destination_id)
        .one()
    )

    ec = _event_count_expr()
    ic = _input_events_expr()
    row = (
        db.query(
            func.count(DeliveryLog.id).label("runtime_telemetry_rows"),
            func.coalesce(func.sum(_lifecycle_row_expr()), 0).label("lifecycle_rows"),
            func.coalesce(
                func.sum(case((DeliveryLog.stage.in_(tuple(DELIVERY_SUCCESS_STAGES)), ec), else_=0)),
                0,
            ).label("delivery_success_events"),
            func.coalesce(
                func.sum(case((DeliveryLog.stage.in_(tuple(DELIVERY_FAILED_STAGES)), ec), else_=0)),
                0,
            ).label("delivery_failed_events"),
            func.coalesce(
                func.sum(case((DeliveryLog.stage.in_(tuple(RETRY_SUCCESS_STAGES)), ec), else_=0)),
                0,
            ).label("retry_success_events"),
            func.coalesce(
                func.sum(case((DeliveryLog.stage.in_(tuple(RETRY_FAILED_STAGES)), ec), else_=0)),
                0,
            ).label("retry_failed_events"),
            func.coalesce(
                func.sum(case((DeliveryLog.stage.in_(tuple(RUN_COMPLETE_STAGES)), ic), else_=0)),
                0,
            ).label("processed_events"),
        )
        .filter(DeliveryLog.created_at >= start, DeliveryLog.created_at < end)
        .one()
    )
    p95_latency = (
        db.query(func.percentile_disc(0.95).within_group(DeliveryLog.latency_ms))
        .filter(
            DeliveryLog.created_at >= start,
            DeliveryLog.created_at < end,
            DeliveryLog.stage.in_(tuple(DELIVERY_OUTCOME_STAGES)),
            DeliveryLog.latency_ms.isnot(None),
        )
        .scalar()
    )

    try:
        health = get_health_overview(
            db,
            window=token,
            since=None,
            stream_id=None,
            route_id=None,
            destination_id=None,
            scoring_mode="current_runtime",
            snapshot_id=resolved_snapshot_id,
        )
        healthy_routes = int(health.routes.healthy or 0)
        idle_routes = int(health.routes.idle or 0)
        unhealthy_routes = int(health.routes.unhealthy or 0)
        critical_routes = int(health.routes.critical or 0)
    except Exception:
        healthy_routes = idle_routes = unhealthy_routes = critical_routes = 0

    success = int(row.delivery_success_events or 0)
    failed = int(row.delivery_failed_events or 0)
    retry_success = int(row.retry_success_events or 0)
    retry_failed = int(row.retry_failed_events or 0)
    outcome_total = success + failed + retry_success + retry_failed

    totals = ObservabilitySummaryTotals(
        streams_total=int(stream_row.streams_total or 0),
        streams_running=int(stream_row.streams_running or 0),
        routes_total=int(route_row.routes_total or 0),
        routes_enabled=int(route_row.routes_enabled or 0),
        healthy_routes=healthy_routes,
        idle_routes=idle_routes,
        unhealthy_routes=unhealthy_routes,
        critical_routes=critical_routes,
        delivery_success_events=success,
        delivery_failed_events=failed,
        retry_success_events=retry_success,
        retry_failed_events=retry_failed,
        runtime_telemetry_rows=int(row.runtime_telemetry_rows or 0),
        lifecycle_rows=int(row.lifecycle_rows or 0),
        processed_events=int(row.processed_events or 0),
        throughput_eps=round(outcome_total / seconds, 6),
        p95_latency_ms=float(p95_latency) if p95_latency is not None else None,
    )

    return ObservabilitySummaryResponse(
        snapshot_id=resolved_snapshot_id,
        generated_at=generated_at.astimezone(timezone.utc),
        window=token,
        window_start=start,
        window_end=end,
        metric_contract_version=METRIC_CONTRACT_VERSION,
        totals=totals,
        metric_contract=observability_metric_contract_payload()["metrics"],
        metric_meta=metric_meta_map(
            "runtime_telemetry_rows.window",
            "processed_events.window",
            "delivery_outcomes.success",
            "delivery_outcomes.failure",
            "delivery_outcomes.window",
            "historical_health.routes",
            "current_runtime.failed_routes",
            "routes.throughput.delivery_outcomes_per_second",
            window_start=start,
            window_end=end,
            generated_at=end,
        ),
    )

