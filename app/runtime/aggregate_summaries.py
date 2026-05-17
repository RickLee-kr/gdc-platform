"""Shared read-only aggregate summaries for runtime KPI semantics.

This module keeps the public meaning of operational numbers explicit:
configuration counts, processed source events, delivery outcome events, and
runtime telemetry row counts are separate aggregates even when they share
``delivery_logs`` as storage.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Integer, case, cast, func, or_
from sqlalchemy.orm import Session

from app.destinations.models import Destination
from app.logs.aggregates import aggregate_delivery_outcome_totals
from app.logs.models import DeliveryLog
from app.routes.models import Route
from app.runtime.metric_contract import get_metric_meta
from app.streams.models import Stream

_DELIVERY_SUCCESS_STAGES = frozenset({"route_send_success", "route_retry_success"})
_DELIVERY_FAILURE_STAGES = frozenset(
    {"route_send_failed", "route_retry_failed", "route_unknown_failure_policy"}
)
_RATE_LIMIT_STAGES = frozenset({"source_rate_limited", "destination_rate_limited"})


@dataclass(frozen=True)
class RuntimeCurrentSummary:
    total_streams: int
    running_streams: int
    paused_streams: int
    error_streams: int
    stopped_streams: int
    rate_limited_source_streams: int
    rate_limited_destination_streams: int
    total_routes: int
    enabled_routes: int
    disabled_routes: int
    total_destinations: int
    enabled_destinations: int
    disabled_destinations: int


@dataclass(frozen=True)
class ProcessedEventsSummary:
    metric_id: str
    meta: dict[str, str]
    processed_events: int
    window_seconds: int
    events_per_second: float


@dataclass(frozen=True)
class DeliveryOutcomesSummary:
    metric_id: str
    meta: dict[str, str]
    success_events: int
    failure_events: int
    total_events: int
    failure_rate: float
    success_rate_percent: float


@dataclass(frozen=True)
class LogRowsSummary:
    metric_id: str
    meta: dict[str, str]
    total_rows: int
    success_rows: int
    failure_rows: int
    rate_limited_rows: int


@dataclass(frozen=True)
class RoutePostureConfigSummary:
    metric_id: str
    meta: dict[str, str]
    total_routes: int
    enabled_routes: int
    disabled_routes: int
    active_enabled_routes: int
    idle_enabled_routes: int


def summarize_runtime_current(db: Session) -> RuntimeCurrentSummary:
    """Configuration/current-state counts, independent of delivery log windows."""

    srow = (
        db.query(
            func.count(Stream.id),
            func.count(Stream.id).filter(Stream.status == "RUNNING"),
            func.count(Stream.id).filter(Stream.status == "PAUSED"),
            func.count(Stream.id).filter(Stream.status == "ERROR"),
            func.count(Stream.id).filter(Stream.status == "STOPPED"),
            func.count(Stream.id).filter(Stream.status == "RATE_LIMITED_SOURCE"),
            func.count(Stream.id).filter(Stream.status == "RATE_LIMITED_DESTINATION"),
        )
        .select_from(Stream)
        .one()
    )
    rrow = (
        db.query(
            func.count(Route.id),
            func.count(Route.id).filter(Route.enabled.is_(True)),
        )
        .select_from(Route)
        .one()
    )
    drow = (
        db.query(
            func.count(Destination.id),
            func.count(Destination.id).filter(Destination.enabled.is_(True)),
        )
        .select_from(Destination)
        .one()
    )

    total_routes = int(rrow[0] or 0)
    enabled_routes = int(rrow[1] or 0)
    total_destinations = int(drow[0] or 0)
    enabled_destinations = int(drow[1] or 0)

    return RuntimeCurrentSummary(
        total_streams=int(srow[0] or 0),
        running_streams=int(srow[1] or 0),
        paused_streams=int(srow[2] or 0),
        error_streams=int(srow[3] or 0),
        stopped_streams=int(srow[4] or 0),
        rate_limited_source_streams=int(srow[5] or 0),
        rate_limited_destination_streams=int(srow[6] or 0),
        total_routes=total_routes,
        enabled_routes=enabled_routes,
        disabled_routes=max(0, total_routes - enabled_routes),
        total_destinations=total_destinations,
        enabled_destinations=enabled_destinations,
        disabled_destinations=max(0, total_destinations - enabled_destinations),
    )


def summarize_processed_events(
    db: Session,
    *,
    start_at: datetime,
    end_at: datetime,
    stream_id: int | None = None,
) -> ProcessedEventsSummary:
    """source_input_events: sum of ``input_events`` on ``run_complete`` rows."""

    q = db.query(
        func.coalesce(
            func.sum(
                func.greatest(
                    0,
                    func.coalesce(
                        cast(DeliveryLog.payload_sample.op("->>")("input_events"), Integer),
                        0,
                    ),
                )
            ),
            0,
        )
    ).filter(
        DeliveryLog.created_at >= start_at,
        DeliveryLog.created_at < end_at,
        DeliveryLog.stage == "run_complete",
        func.upper(func.coalesce(DeliveryLog.level, "")) != "DEBUG",
    )
    if stream_id is not None:
        q = q.filter(DeliveryLog.stream_id == stream_id)
    processed = int(q.scalar() or 0)
    seconds = max(1, int((end_at - start_at).total_seconds()))
    return ProcessedEventsSummary(
        metric_id="processed_events.window",
        meta=get_metric_meta("processed_events.window", window_start=start_at, window_end=end_at, generated_at=end_at),
        processed_events=processed,
        window_seconds=seconds,
        events_per_second=round(processed / seconds, 6),
    )


def summarize_delivery_outcomes(
    db: Session,
    *,
    start_at: datetime,
    end_at: datetime,
    stream_id: int | None = None,
    route_id: int | None = None,
    destination_id: int | None = None,
) -> DeliveryOutcomesSummary:
    """delivery_outcome_events: event_count sums on route delivery outcome stages."""

    raw = aggregate_delivery_outcome_totals(
        db,
        start_at=start_at,
        end_at=end_at,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    total = raw.success_events + raw.failure_events
    failure_rate = round(raw.failure_events / total, 6) if total > 0 else 0.0
    success_rate_percent = round(100.0 * raw.success_events / total, 1) if total > 0 else 0.0
    return DeliveryOutcomesSummary(
        metric_id="delivery_outcomes.window",
        meta=get_metric_meta("delivery_outcomes.window", window_start=start_at, window_end=end_at, generated_at=end_at),
        success_events=raw.success_events,
        failure_events=raw.failure_events,
        total_events=total,
        failure_rate=failure_rate,
        success_rate_percent=success_rate_percent,
    )


def summarize_log_rows(
    db: Session,
    *,
    start_at: datetime,
    end_at: datetime,
    stream_id: int | None = None,
    route_id: int | None = None,
    destination_id: int | None = None,
) -> LogRowsSummary:
    """TELEMETRY_ROWS: committed delivery_logs rows, not source/delivery event counts."""

    success_expr = case((DeliveryLog.stage.in_(_DELIVERY_SUCCESS_STAGES), 1), else_=0)
    failure_expr = case((DeliveryLog.stage.in_(_DELIVERY_FAILURE_STAGES), 1), else_=0)
    rl_expr = case((DeliveryLog.stage.in_(_RATE_LIMIT_STAGES), 1), else_=0)
    q = (
        db.query(
            func.count(DeliveryLog.id).label("total_rows"),
            func.coalesce(func.sum(success_expr), 0).label("success_rows"),
            func.coalesce(func.sum(failure_expr), 0).label("failure_rows"),
            func.coalesce(func.sum(rl_expr), 0).label("rate_limited_rows"),
        )
        .filter(DeliveryLog.created_at >= start_at, DeliveryLog.created_at < end_at)
    )
    if stream_id is not None:
        q = q.filter(DeliveryLog.stream_id == stream_id)
    if route_id is not None:
        q = q.filter(DeliveryLog.route_id == route_id)
    if destination_id is not None:
        q = q.filter(DeliveryLog.destination_id == destination_id)
    row = q.one()
    return LogRowsSummary(
        metric_id="runtime_telemetry_rows.window",
        meta=get_metric_meta("runtime_telemetry_rows.window", window_start=start_at, window_end=end_at, generated_at=end_at),
        total_rows=int(row.total_rows or 0),
        success_rows=int(row.success_rows or 0),
        failure_rows=int(row.failure_rows or 0),
        rate_limited_rows=int(row.rate_limited_rows or 0),
    )


def summarize_route_posture_config(
    db: Session,
    *,
    active_route_ids: list[int],
    stream_id: int | None = None,
    route_id: int | None = None,
    destination_id: int | None = None,
) -> RoutePostureConfigSummary:
    """Configured route posture counts used to expose idle/disabled explicitly."""

    q = db.query(Route).outerjoin(Destination, Destination.id == Route.destination_id)
    if stream_id is not None:
        q = q.filter(Route.stream_id == stream_id)
    if route_id is not None:
        q = q.filter(Route.id == route_id)
    if destination_id is not None:
        q = q.filter(Route.destination_id == destination_id)

    total = int(q.with_entities(func.count(Route.id)).scalar() or 0)
    enabled = int(
        q.filter(Route.enabled.is_(True), or_(Destination.id.is_(None), Destination.enabled.is_(True)))
        .with_entities(func.count(Route.id))
        .scalar()
        or 0
    )
    disabled = max(0, total - enabled)
    active_ids = {int(rid) for rid in active_route_ids}
    active_enabled = 0
    if active_ids:
        active_enabled = int(
            q.filter(
                Route.id.in_(active_ids),
                Route.enabled.is_(True),
                or_(Destination.id.is_(None), Destination.enabled.is_(True)),
            )
            .with_entities(func.count(Route.id))
            .scalar()
            or 0
        )
    return RoutePostureConfigSummary(
        metric_id="route_config.total",
        meta=get_metric_meta("route_config.total"),
        total_routes=total,
        enabled_routes=enabled,
        disabled_routes=disabled,
        active_enabled_routes=active_enabled,
        idle_enabled_routes=max(0, enabled - active_enabled),
    )

