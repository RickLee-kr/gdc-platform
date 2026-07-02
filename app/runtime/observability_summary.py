"""Canonical observability summary read model."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import Integer, case, cast, func, or_
from sqlalchemy.orm import Session

from app.destinations.models import Destination
from app.logs.models import DeliveryLog
from app.routes.models import Route
from app.runtime.aggregate_summaries import summarize_route_posture_config
from app.runtime.metric_contract import metric_meta_map
from app.runtime.metrics_window import (
    OPERATIONAL_WINDOWS,
    normalize_metrics_window_token,
    parse_metrics_window,
)
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
from app.runtime.query_boundary import materialize_live_aggregate_snapshot
from app.runtime.read_service import _dashboard_snapshot_id, _dashboard_snapshot_time
from app.runtime.schemas import ObservabilitySummaryResponse, ObservabilitySummaryTotals
from app.streams.models import Stream

logger = logging.getLogger(__name__)


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


@dataclass(frozen=True)
class _ObservabilityMetricTotals:
    runtime_telemetry_rows: int
    lifecycle_rows: int
    delivery_success_events: int
    delivery_failed_events: int
    retry_success_events: int
    retry_failed_events: int
    processed_events: int
    p95_latency_ms: float | None


def get_observability_summary(
    db: Session,
    *,
    window: str = "24h",
    snapshot_id: str | None = None,
) -> ObservabilitySummaryResponse:
    """Build the shared top-level metrics snapshot for operations pages."""

    token = normalize_metrics_window_token(window)
    if snapshot_id is not None:
        return materialize_live_aggregate_snapshot(
            db,
            scope="runtime_observability_summary",
            key=f"window={token}",
            snapshot_id=snapshot_id,
            model_type=ObservabilitySummaryResponse,
            builder=lambda: _build_observability_summary(db, window=token, snapshot_id=snapshot_id),
        )
    from app.runtime.observability_read_cache import get_observability_summary_cached

    return get_observability_summary_cached(db, window=token, snapshot_id=snapshot_id)


def _build_observability_summary(
    db: Session,
    *,
    window: str = "24h",
    snapshot_id: str | None = None,
) -> ObservabilitySummaryResponse:

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

    metrics = _resolve_observability_metric_totals(
        db,
        window=token,
        start=start,
        end=end,
        seconds=seconds,
        snapshot_id=snapshot_id,
    )

    try:
        from app.config import settings
        from app.runtime.health_snapshot_read import list_route_health_from_snapshots, snapshot_health_available

        if (
            bool(getattr(settings, "GDC_HEALTH_SNAPSHOT_READ_ENABLED", True))
            and snapshot_health_available(db)
        ):
            route_health = list_route_health_from_snapshots(
                db,
                window=token,
                since=None,
                stream_id=None,
                route_id=None,
                destination_id=None,
                scoring_mode="current_runtime",
                snapshot_id=resolved_snapshot_id,
            )
        else:
            from app.runtime.health_service import list_route_health

            route_health = list_route_health(
                db,
                window=token,
                since=None,
                stream_id=None,
                route_id=None,
                destination_id=None,
                scoring_mode="current_runtime",
                snapshot_id=resolved_snapshot_id,
            )
        route_posture = summarize_route_posture_config(
            db,
            active_route_ids=[row.route_id for row in route_health.rows],
        )
        healthy_routes = sum(1 for row in route_health.rows if row.level == "HEALTHY")
        idle_routes = int(route_posture.idle_enabled_routes or 0)
        unhealthy_routes = sum(1 for row in route_health.rows if row.level == "UNHEALTHY")
        critical_routes = sum(1 for row in route_health.rows if row.level == "CRITICAL")
    except Exception:
        healthy_routes = idle_routes = unhealthy_routes = critical_routes = 0

    success = metrics.delivery_success_events
    failed = metrics.delivery_failed_events
    retry_success = metrics.retry_success_events
    retry_failed = metrics.retry_failed_events
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
        runtime_telemetry_rows=metrics.runtime_telemetry_rows,
        lifecycle_rows=metrics.lifecycle_rows,
        processed_events=metrics.processed_events,
        throughput_eps=round(outcome_total / seconds, 6),
        p95_latency_ms=metrics.p95_latency_ms,
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


def _resolve_observability_metric_totals(
    db: Session,
    *,
    window: str,
    start: datetime,
    end: datetime,
    seconds: int,
    snapshot_id: str | None,
) -> _ObservabilityMetricTotals:
    from app.runtime import runtime_analytics_bucket_read_repository as bucket_read
    from app.runtime.runtime_snapshot_analytics_repository import snapshot_analytics_available

    if bucket_read.historical_analytics_available(db):
        try:
            return _observability_totals_from_buckets(db, start=start, end=end, seconds=seconds)
        except Exception:
            db.rollback()
            logger.exception("observability_summary_buckets_degraded")

    if snapshot_analytics_available(db) and window in OPERATIONAL_WINDOWS:
        try:
            return _observability_totals_from_snapshot(db, window=window, seconds=seconds, snapshot_id=snapshot_id)
        except Exception:
            db.rollback()
            logger.exception("observability_summary_snapshot_degraded")

    try:
        return _observability_totals_from_incremental(db, start=start, end=end)
    except Exception:
        db.rollback()
        logger.exception("observability_summary_incremental_degraded")

    return _observability_totals_from_delivery_logs(db, start=start, end=end)


def _observability_totals_from_buckets(
    db: Session,
    *,
    start: datetime,
    end: datetime,
    seconds: int,
) -> _ObservabilityMetricTotals:
    from app.runtime import runtime_analytics_bucket_read_repository as bucket_read

    bucket = bucket_read.fetch_observability_totals_from_buckets(
        db,
        since=start,
        until=end,
        window_seconds=seconds,
    )
    retry_rows = int(bucket.retry_event_rows or 0)
    return _ObservabilityMetricTotals(
        runtime_telemetry_rows=bucket.runtime_telemetry_rows,
        lifecycle_rows=0,
        delivery_success_events=bucket.delivery_success_events,
        delivery_failed_events=bucket.delivery_failed_events,
        retry_success_events=retry_rows,
        retry_failed_events=0,
        processed_events=bucket.processed_events,
        p95_latency_ms=bucket.p95_latency_ms,
    )


def _observability_totals_from_snapshot(
    db: Session,
    *,
    window: str,
    seconds: int,
    snapshot_id: str | None,
) -> _ObservabilityMetricTotals:
    from app.logs import incremental_aggregates as incremental
    from app.runtime.models import RuntimeRouteSnapshot
    from app.runtime.runtime_snapshot_analytics_repository import _int_events, _operational_scale

    token = normalize_metrics_window_token(window)
    td = parse_metrics_window(token)
    scale = _operational_scale(int(td.total_seconds()))
    route_snaps = {
        int(r.route_id): r
        for r in db.query(RuntimeRouteSnapshot).all()
    }
    delivery_success = 0
    delivery_failure = 0
    for snap in route_snaps.values():
        delivery_success += _int_events(float(snap.delivered_eps_1m), 60)
        delivery_failure += _int_events(float(snap.failed_eps_1m), 60)
    delivery_success = int(round(delivery_success * scale))
    delivery_failure = int(round(delivery_failure * scale))

    generated_at = _dashboard_snapshot_time(snapshot_id)
    start = generated_at - td
    end = generated_at
    retry_success, retry_failed, _ = incremental.retry_summary(
        db,
        since=start,
        until=end,
        stream_id=None,
        route_id=None,
        destination_id=None,
    )
    processed = incremental.processed_event_total(db, start_at=start, end_at=end)
    row_totals = incremental.log_row_totals(
        db,
        start_at=start,
        end_at=end,
        stream_id=None,
        route_id=None,
        destination_id=None,
    )
    lifecycle_rows = max(
        0,
        int(row_totals.total_rows)
        - int(row_totals.success_rows + row_totals.failure_rows + row_totals.rate_limited_rows),
    )
    return _ObservabilityMetricTotals(
        runtime_telemetry_rows=int(row_totals.total_rows),
        lifecycle_rows=lifecycle_rows,
        delivery_success_events=delivery_success,
        delivery_failed_events=delivery_failure,
        retry_success_events=int(retry_success),
        retry_failed_events=int(retry_failed),
        processed_events=int(processed),
        p95_latency_ms=None,
    )


def _observability_totals_from_incremental(
    db: Session,
    *,
    start: datetime,
    end: datetime,
) -> _ObservabilityMetricTotals:
    from app.logs import incremental_aggregates as incremental

    success, failed = incremental.delivery_outcome_totals(
        db,
        start_at=start,
        end_at=end,
        stream_id=None,
        route_id=None,
        destination_id=None,
    )
    retry_success, retry_failed, _ = incremental.retry_summary(
        db,
        since=start,
        until=end,
        stream_id=None,
        route_id=None,
        destination_id=None,
    )
    processed = incremental.processed_event_total(db, start_at=start, end_at=end)
    row_totals = incremental.log_row_totals(
        db,
        start_at=start,
        end_at=end,
        stream_id=None,
        route_id=None,
        destination_id=None,
    )
    lifecycle_rows = max(
        0,
        int(row_totals.total_rows)
        - int(row_totals.success_rows + row_totals.failure_rows + row_totals.rate_limited_rows),
    )
    avg, p95 = incremental.latency_avg_p95(
        db,
        since=start,
        until=end,
        stream_id=None,
        route_id=None,
        destination_id=None,
    )
    return _ObservabilityMetricTotals(
        runtime_telemetry_rows=int(row_totals.total_rows),
        lifecycle_rows=lifecycle_rows,
        delivery_success_events=int(success),
        delivery_failed_events=int(failed),
        retry_success_events=int(retry_success),
        retry_failed_events=int(retry_failed),
        processed_events=int(processed),
        p95_latency_ms=float(p95) if p95 is not None else (float(avg) if avg is not None else None),
    )


def _observability_totals_from_delivery_logs(
    db: Session,
    *,
    start: datetime,
    end: datetime,
) -> _ObservabilityMetricTotals:
    """Forensic fallback when snapshot/bucket/incremental paths are unavailable."""

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
    return _ObservabilityMetricTotals(
        runtime_telemetry_rows=int(row.runtime_telemetry_rows or 0),
        lifecycle_rows=int(row.lifecycle_rows or 0),
        delivery_success_events=int(row.delivery_success_events or 0),
        delivery_failed_events=int(row.delivery_failed_events or 0),
        retry_success_events=int(row.retry_success_events or 0),
        retry_failed_events=int(row.retry_failed_events or 0),
        processed_events=int(row.processed_events or 0),
        p95_latency_ms=float(p95_latency) if p95_latency is not None else None,
    )
