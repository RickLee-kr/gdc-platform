"""Read-only aggregation for runtime stats, health, dashboard, and log search (no DB writes)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal, cast

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.destinations.models import Destination
from app.logs.models import DeliveryLog
from app.logs.aggregates import aggregate_warn_error_summaries
from app.logs.aggregates import aggregate_platform_outcome_buckets, dense_platform_outcome_buckets
from app.logs.repository import (
    aggregate_failure_trend_buckets,
    list_checkpoint_update_logs_for_stream,
    list_delivery_logs_by_run_id,
    list_recent_delivery_logs_for_stream,
    list_recent_delivery_logs_global,
    list_recent_delivery_logs_global_since,
    list_timeline_delivery_logs_for_stream,
    page_delivery_logs,
    search_delivery_logs,
)
from app.mappings.models import Mapping
from app.enrichments.models import Enrichment
from app.routes.models import Route
from app.security.secrets import mask_secrets
from app.sources.models import Source
from app.formatters.config_resolver import resolve_formatter_config
from app.formatters.message_prefix import effective_message_prefix_enabled, effective_message_prefix_template
from app.runtime.metrics_window import bucket_seconds_for_window, max_buckets_for_window, parse_metrics_window
from app.runtime.schemas import (
    CheckpointHistoryItem,
    CheckpointHistoryResponse,
    CheckpointStatsPayload,
    CheckpointTraceResponse,
    CheckpointTraceRouteFailureRef,
    CheckpointTraceTimelineNode,
    ConnectorUIConfigConnector,
    ConnectorUIConfigResponse,
    ConnectorUIConfigSourceSummary,
    ConnectorUIConfigStreamSummary,
    ConnectorUIConfigSummary,
    DashboardOutcomeBucket,
    DashboardOutcomeTimeseriesResponse,
    DashboardSummaryNumbers,
    DashboardSummaryResponse,
    DestinationUIConfigDestination,
    DestinationUIConfigResponse,
    DestinationUIConfigRouteItem,
    RecentDeliveryLogItem,
    RecentProblemRouteItem,
    RecentRateLimitedRouteItem,
    RecentUnhealthyStreamItem,
    RouteHealthItem,
    RouteHealthState,
    RouteRuntimeCounts,
    RouteRuntimeStatsItem,
    RuntimeLogSearchFilters,
    RuntimeLogSearchItem,
    RuntimeFailureTrendBucket,
    RuntimeFailureTrendResponse,
    RuntimeLogsPageItem,
    RuntimeLogsPageResponse,
    RuntimeLogSearchResponse,
    RuntimeTraceCheckpointEvent,
    RuntimeTraceConnectorRef,
    RuntimeTraceDestinationRef,
    RuntimeTraceResponse,
    RuntimeTraceRouteRef,
    RuntimeTraceStreamRef,
    RuntimeTraceTimelineEntry,
    RuntimeTimelineItem,
    RuntimeTimelineResponse,
    RouteUIConfigResponse,
    RouteUIConfigRoute,
    RouteUIConfigDestination,
    SourceUIConfigResponse,
    SourceUIConfigSource,
    SourceUIConfigStreamItem,
    StreamHealthResponse,
    StreamHealthState,
    StreamHealthSummary,
    StreamUIConfigEnrichmentSummary,
    StreamUIConfigMappingSummary,
    StreamUIConfigResponse,
    StreamUIConfigRouteSummary,
    StreamUIConfigSourceSummary,
    StreamUIConfigStream,
    MappingUIConfigEnrichment,
    MappingUIConfigMapping,
    MappingUIConfigResponse,
    MappingUIConfigRouteItem,
    StreamRuntimeLastSeen,
    StreamRuntimeStatsHealthBundleResponse,
    StreamRuntimeStatsResponse,
    StreamRuntimeSummary,
    RuntimeAlertSummaryItem,
    RuntimeAlertSummaryResponse,
)
from app.scheduler.runtime_state import active_worker_count, scheduler_started_at, scheduler_uptime_seconds
from app.startup_readiness import get_startup_snapshot
from app.streams.models import Stream
from app.validation.ops_read import build_validation_operational_summary
from app.validation.schemas import ValidationOperationalSummaryResponse


class StreamNotFoundError(Exception):
    """Raised when stream_id is missing; router maps this to HTTP 404 STREAM_NOT_FOUND."""

    def __init__(self, stream_id: int) -> None:
        super().__init__(stream_id)
        self.stream_id = stream_id


class RouteNotFoundError(Exception):
    """Raised when route_id is missing; router maps this to HTTP 404 ROUTE_NOT_FOUND."""

    def __init__(self, route_id: int) -> None:
        super().__init__(route_id)
        self.route_id = route_id


class DestinationNotFoundError(Exception):
    """Raised when destination_id is missing; router maps this to HTTP 404 DESTINATION_NOT_FOUND."""

    def __init__(self, destination_id: int) -> None:
        super().__init__(destination_id)
        self.destination_id = destination_id


class SourceNotFoundError(Exception):
    """Raised when source_id is missing; router maps this to HTTP 404 SOURCE_NOT_FOUND."""

    def __init__(self, source_id: int) -> None:
        super().__init__(source_id)
        self.source_id = source_id


class ConnectorNotFoundError(Exception):
    """Raised when connector_id is missing; router maps this to HTTP 404 CONNECTOR_NOT_FOUND."""

    def __init__(self, connector_id: int) -> None:
        super().__init__(connector_id)
        self.connector_id = connector_id


class DeliveryLogNotFoundError(Exception):
    """Raised when delivery_logs.id is missing; router maps to HTTP 404."""

    def __init__(self, log_id: int) -> None:
        super().__init__(log_id)
        self.log_id = log_id


class RunTraceNotFoundError(Exception):
    """Raised when no delivery_logs rows exist for a run_id."""

    def __init__(self, run_id: str) -> None:
        super().__init__(run_id)
        self.run_id = run_id


_SUMMARY_STAGE_FIELDS = (
    "route_send_success",
    "route_send_failed",
    "route_retry_success",
    "route_retry_failed",
    "route_skip",
    "source_rate_limited",
    "destination_rate_limited",
    "route_unknown_failure_policy",
    "run_complete",
)

_ROUTE_COUNT_FIELDS = (
    "route_send_success",
    "route_send_failed",
    "route_retry_success",
    "route_retry_failed",
    "destination_rate_limited",
    "route_skip",
    "route_unknown_failure_policy",
)

_SUCCESS_STAGES = frozenset({"route_send_success", "route_retry_success"})
_FAILURE_STAGES = frozenset({"route_send_failed", "route_retry_failed"})
_RL_STAGES = frozenset({"source_rate_limited", "destination_rate_limited"})

_HEALTH_SUCCESS_STAGES = frozenset({"route_send_success", "route_retry_success"})
_HEALTH_FAILURE_STAGES = frozenset({"route_send_failed", "route_retry_failed", "route_unknown_failure_policy"})
_HEALTH_DEST_RATE_LIMIT_STAGES = frozenset({"destination_rate_limited"})
_STREAM_HEALTH_BAD_STAGES = _HEALTH_FAILURE_STAGES | _HEALTH_DEST_RATE_LIMIT_STAGES
_CONSEC_BAD_STAGES = _STREAM_HEALTH_BAD_STAGES

_DASHBOARD_SUCCESS_STAGES = _HEALTH_SUCCESS_STAGES
_DASHBOARD_FAILURE_STAGES = _HEALTH_FAILURE_STAGES
_DASHBOARD_RATE_LIMIT_STAGES = frozenset({"source_rate_limited", "destination_rate_limited"})
_DASHBOARD_UNHEALTHY_STREAM_STAGES = _DASHBOARD_FAILURE_STAGES | _DASHBOARD_RATE_LIMIT_STAGES

_STREAM_STATUS_RUNNING = "RUNNING"
_STREAM_STATUS_PAUSED = "PAUSED"
_STREAM_STATUS_ERROR = "ERROR"
_STREAM_STATUS_STOPPED = "STOPPED"
_STREAM_STATUS_RL_SOURCE = "RATE_LIMITED_SOURCE"
_STREAM_STATUS_RL_DEST = "RATE_LIMITED_DESTINATION"


def _max_created_at(rows: list[DeliveryLog], stages: frozenset[str]) -> datetime | None:
    best: datetime | None = None
    for row in rows:
        if row.stage in stages:
            ts = row.created_at
            if best is None or ts > best:
                best = ts
    return best


def _compute_summary(logs: list[DeliveryLog]) -> StreamRuntimeSummary:
    acc = {k: 0 for k in _SUMMARY_STAGE_FIELDS}
    for row in logs:
        if row.stage in acc:
            acc[row.stage] += 1
    return StreamRuntimeSummary(total_logs=len(logs), **acc)


def _compute_last_seen(logs: list[DeliveryLog]) -> StreamRuntimeLastSeen:
    return StreamRuntimeLastSeen(
        success_at=_max_created_at(logs, _SUCCESS_STAGES),
        failure_at=_max_created_at(logs, _FAILURE_STAGES),
        rate_limited_at=_max_created_at(logs, _RL_STAGES),
    )


def _route_counts_for(route_id: int, logs: list[DeliveryLog]) -> RouteRuntimeCounts:
    acc = {k: 0 for k in _ROUTE_COUNT_FIELDS}
    for row in logs:
        if row.route_id != route_id:
            continue
        if row.stage in acc:
            acc[row.stage] += 1
    return RouteRuntimeCounts(**acc)


def _route_last_success(route_id: int, logs: list[DeliveryLog]) -> datetime | None:
    scoped = [r for r in logs if r.route_id == route_id]
    return _max_created_at(scoped, _SUCCESS_STAGES)


def _route_last_failure(route_id: int, logs: list[DeliveryLog]) -> datetime | None:
    scoped = [r for r in logs if r.route_id == route_id]
    return _max_created_at(scoped, _FAILURE_STAGES)


def _build_route_stats_items(routes: list[Route], logs: list[DeliveryLog]) -> list[RouteRuntimeStatsItem]:
    items: list[RouteRuntimeStatsItem] = []
    for route in routes:
        dest = route.destination
        dest_type = str(dest.destination_type or "").strip().upper() if dest is not None else ""
        rid = int(route.id)
        items.append(
            RouteRuntimeStatsItem(
                route_id=rid,
                destination_id=int(route.destination_id),
                destination_type=dest_type,
                enabled=bool(route.enabled),
                failure_policy=str(route.failure_policy),
                status=str(route.status),
                counts=_route_counts_for(rid, logs),
                last_success_at=_route_last_success(rid, logs),
                last_failure_at=_route_last_failure(rid, logs),
            )
        )
    return items


def _recent_log_items(logs: list[DeliveryLog]) -> list[RecentDeliveryLogItem]:
    return [
        RecentDeliveryLogItem(
            id=int(row.id),
            stage=row.stage,
            level=row.level,
            status=row.status,
            message=row.message,
            route_id=row.route_id,
            destination_id=row.destination_id,
            error_code=row.error_code,
            created_at=row.created_at,
        )
        for row in logs
    ]


def _to_runtime_log_search_item(row: DeliveryLog) -> RuntimeLogSearchItem:
    return RuntimeLogSearchItem(
        id=int(row.id),
        connector_id=row.connector_id,
        stream_id=row.stream_id,
        route_id=row.route_id,
        destination_id=row.destination_id,
        run_id=row.run_id,
        stage=row.stage,
        level=row.level,
        status=row.status,
        message=row.message,
        retry_count=int(row.retry_count),
        http_status=row.http_status,
        latency_ms=row.latency_ms,
        error_code=row.error_code,
        created_at=row.created_at,
    )


def _to_logs_page_item(row: DeliveryLog) -> RuntimeLogsPageItem:
    return RuntimeLogsPageItem(
        id=int(row.id),
        created_at=row.created_at,
        connector_id=row.connector_id,
        stream_id=row.stream_id,
        route_id=row.route_id,
        destination_id=row.destination_id,
        run_id=row.run_id,
        stage=row.stage,
        level=row.level,
        status=row.status,
        message=row.message,
        error_code=row.error_code,
        retry_count=int(row.retry_count),
        http_status=row.http_status,
        latency_ms=row.latency_ms,
    )


def _to_timeline_item(row: DeliveryLog) -> RuntimeTimelineItem:
    return RuntimeTimelineItem(
        id=int(row.id),
        created_at=row.created_at,
        stream_id=int(row.stream_id) if row.stream_id is not None else None,
        route_id=int(row.route_id) if row.route_id is not None else None,
        destination_id=int(row.destination_id) if row.destination_id is not None else None,
        run_id=row.run_id,
        stage=row.stage,
        level=row.level,
        status=row.status,
        message=row.message,
        error_code=row.error_code,
        retry_count=int(row.retry_count),
        http_status=row.http_status,
        latency_ms=row.latency_ms,
    )


def _count_dashboard_log_categories(logs: list[DeliveryLog]) -> tuple[int, int, int]:
    successes = failures = rate_limited = 0
    for row in logs:
        if row.stage in _DASHBOARD_SUCCESS_STAGES:
            successes += 1
        elif row.stage in _DASHBOARD_FAILURE_STAGES:
            failures += 1
        elif row.stage in _DASHBOARD_RATE_LIMIT_STAGES:
            rate_limited += 1
    return successes, failures, rate_limited


def _dedupe_recent_problem_routes(logs: list[DeliveryLog]) -> list[RecentProblemRouteItem]:
    seen_route: set[int] = set()
    out: list[RecentProblemRouteItem] = []
    for row in logs:
        if row.route_id is None or row.stream_id is None:
            continue
        if row.stage not in _DASHBOARD_FAILURE_STAGES:
            continue
        rid = int(row.route_id)
        if rid in seen_route:
            continue
        seen_route.add(rid)
        out.append(
            RecentProblemRouteItem(
                stream_id=int(row.stream_id),
                route_id=rid,
                destination_id=int(row.destination_id) if row.destination_id is not None else None,
                stage=row.stage,
                error_code=row.error_code,
                message=row.message,
                created_at=row.created_at,
            )
        )
        if len(out) >= 10:
            break
    return out


def _dedupe_recent_rate_limited_routes(logs: list[DeliveryLog]) -> list[RecentRateLimitedRouteItem]:
    seen_route: set[int] = set()
    out: list[RecentRateLimitedRouteItem] = []
    for row in logs:
        if row.route_id is None or row.stream_id is None:
            continue
        if row.stage != "destination_rate_limited":
            continue
        rid = int(row.route_id)
        if rid in seen_route:
            continue
        seen_route.add(rid)
        out.append(
            RecentRateLimitedRouteItem(
                stream_id=int(row.stream_id),
                route_id=rid,
                destination_id=int(row.destination_id) if row.destination_id is not None else None,
                stage=row.stage,
                error_code=row.error_code,
                message=row.message,
                created_at=row.created_at,
            )
        )
        if len(out) >= 10:
            break
    return out


def _dedupe_recent_unhealthy_streams(
    logs: list[DeliveryLog],
    stream_status_by_id: dict[int, str],
) -> list[RecentUnhealthyStreamItem]:
    seen_stream: set[int] = set()
    out: list[RecentUnhealthyStreamItem] = []
    for row in logs:
        if row.stream_id is None:
            continue
        if row.stage not in _DASHBOARD_UNHEALTHY_STREAM_STAGES:
            continue
        sid = int(row.stream_id)
        if sid in seen_stream:
            continue
        seen_stream.add(sid)
        out.append(
            RecentUnhealthyStreamItem(
                stream_id=sid,
                stream_status=str(stream_status_by_id.get(sid, "")),
                last_problem_stage=row.stage,
                last_error_code=row.error_code,
                last_error_message=row.message,
                last_problem_at=row.created_at,
            )
        )
        if len(out) >= 10:
            break
    return out


def _logs_for_route(logs: list[DeliveryLog], route_id: int) -> list[DeliveryLog]:
    return [row for row in logs if row.route_id == route_id]


def _logs_newest_first(logs: list[DeliveryLog]) -> list[DeliveryLog]:
    return sorted(logs, key=lambda r: r.created_at, reverse=True)


def _route_success_failure_rl_counts(route_logs: list[DeliveryLog]) -> tuple[int, int, int]:
    success = sum(1 for row in route_logs if row.stage in _HEALTH_SUCCESS_STAGES)
    failure = sum(1 for row in route_logs if row.stage in _HEALTH_FAILURE_STAGES)
    rate_limited = sum(1 for row in route_logs if row.stage in _HEALTH_DEST_RATE_LIMIT_STAGES)
    return success, failure, rate_limited


def _last_ts_for_stages(route_logs: list[DeliveryLog], stages: frozenset[str]) -> datetime | None:
    scoped = [row.created_at for row in route_logs if row.stage in stages]
    return max(scoped) if scoped else None


def _last_error_fields(route_logs: list[DeliveryLog]) -> tuple[str | None, str | None]:
    bad_rows = [row for row in route_logs if row.stage in _CONSEC_BAD_STAGES]
    if not bad_rows:
        return None, None
    newest = max(bad_rows, key=lambda r: r.created_at)
    return newest.error_code, newest.message


def _consecutive_failure_count(route_logs_newest_first: list[DeliveryLog]) -> int:
    count = 0
    for row in route_logs_newest_first:
        if row.stage in _HEALTH_SUCCESS_STAGES:
            break
        if row.stage in _CONSEC_BAD_STAGES:
            count += 1
    return count


def _classify_enabled_route_health(route_logs: list[DeliveryLog]) -> str:
    if not route_logs:
        return "IDLE"
    has_success = any(row.stage in _HEALTH_SUCCESS_STAGES for row in route_logs)
    has_bad = any(row.stage in _STREAM_HEALTH_BAD_STAGES for row in route_logs)
    if has_bad and not has_success:
        return "UNHEALTHY"
    if has_success and has_bad:
        return "DEGRADED"
    if has_success and not has_bad:
        return "HEALTHY"
    return "IDLE"


def _compute_stream_health(logs: list[DeliveryLog], routes: list[Route]) -> str:
    if not logs:
        return "IDLE"
    if routes and all(not bool(r.enabled) for r in routes):
        return "IDLE"

    disabled_ids = {int(r.id) for r in routes if not bool(r.enabled)}
    scoped = [
        row
        for row in logs
        if row.route_id is None or int(row.route_id) not in disabled_ids
    ]
    if not scoped:
        return "IDLE"

    has_success = any(row.stage in _HEALTH_SUCCESS_STAGES for row in scoped)
    has_bad = any(row.stage in _STREAM_HEALTH_BAD_STAGES for row in scoped)
    if has_bad and not has_success:
        return "UNHEALTHY"
    if has_success and has_bad:
        return "DEGRADED"
    if has_success and not has_bad:
        return "HEALTHY"
    return "IDLE"


def _build_route_health_items(logs: list[DeliveryLog], routes: list[Route]) -> tuple[list[RouteHealthItem], StreamHealthSummary]:
    bucket = {"HEALTHY": 0, "DEGRADED": 0, "UNHEALTHY": 0, "DISABLED": 0, "IDLE": 0}
    items: list[RouteHealthItem] = []

    for route in routes:
        rid = int(route.id)
        route_logs = _logs_for_route(logs, rid)
        route_logs_nf = _logs_newest_first(route_logs)
        success_c, failure_c, rl_c = _route_success_failure_rl_counts(route_logs)
        last_err_code, last_err_msg = _last_error_fields(route_logs)
        consec = _consecutive_failure_count(route_logs_nf)

        dest = route.destination
        dest_type = str(dest.destination_type or "").strip().upper() if dest is not None else ""
        dest_enabled = bool(dest.enabled) if dest is not None else False

        if not bool(route.enabled):
            health_key = "DISABLED"
        else:
            health_key = _classify_enabled_route_health(route_logs)

        bucket[health_key] += 1

        items.append(
            RouteHealthItem(
                route_id=rid,
                destination_id=int(route.destination_id),
                destination_type=dest_type,
                route_enabled=bool(route.enabled),
                destination_enabled=dest_enabled,
                failure_policy=str(route.failure_policy),
                route_status=str(route.status),
                health=cast(RouteHealthState, health_key),
                success_count=success_c,
                failure_count=failure_c,
                rate_limited_count=rl_c,
                consecutive_failure_count=consec,
                last_success_at=_last_ts_for_stages(route_logs, _HEALTH_SUCCESS_STAGES),
                last_failure_at=_last_ts_for_stages(route_logs, _HEALTH_FAILURE_STAGES),
                last_rate_limited_at=_last_ts_for_stages(route_logs, _HEALTH_DEST_RATE_LIMIT_STAGES),
                last_error_code=last_err_code,
                last_error_message=last_err_msg,
            )
        )

    summary = StreamHealthSummary(
        total_routes=len(routes),
        healthy_routes=bucket["HEALTHY"],
        degraded_routes=bucket["DEGRADED"],
        unhealthy_routes=bucket["UNHEALTHY"],
        disabled_routes=bucket["DISABLED"],
        idle_routes=bucket["IDLE"],
    )
    return items, summary


def _load_stream_recent_logs_and_routes(
    db: Session, stream_id: int, limit: int
) -> tuple[Stream, list[DeliveryLog], list[Route]]:
    """Single stream lookup plus one delivery_logs scan and route list (shared by stats/health)."""

    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if stream is None:
        raise StreamNotFoundError(stream_id)
    logs = list_recent_delivery_logs_for_stream(db, stream_id, limit=limit)
    routes = (
        db.query(Route)
        .options(joinedload(Route.destination))
        .filter(Route.stream_id == stream_id)
        .order_by(Route.id.asc())
        .all()
    )
    return stream, logs, routes


def get_stream_runtime_stats(db: Session, stream_id: int, limit: int) -> StreamRuntimeStatsResponse:
    stream, logs, routes = _load_stream_recent_logs_and_routes(db, stream_id, limit)

    checkpoint_row = db.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).first()
    checkpoint_out: CheckpointStatsPayload | None = None
    if checkpoint_row is not None:
        checkpoint_out = CheckpointStatsPayload(
            type=checkpoint_row.checkpoint_type,
            value=checkpoint_row.checkpoint_value_json or {},
        )

    return StreamRuntimeStatsResponse(
        stream_id=int(stream.id),
        stream_status=str(stream.status),
        checkpoint=checkpoint_out,
        summary=_compute_summary(logs),
        last_seen=_compute_last_seen(logs),
        routes=_build_route_stats_items(routes, logs),
        recent_logs=_recent_log_items(logs),
    )


def get_stream_runtime_health(db: Session, stream_id: int, limit: int) -> StreamHealthResponse:
    stream, logs, routes = _load_stream_recent_logs_and_routes(db, stream_id, limit)
    route_items, summary = _build_route_health_items(logs, routes)
    stream_health = _compute_stream_health(logs, routes)

    return StreamHealthResponse(
        stream_id=int(stream.id),
        stream_status=str(stream.status),
        health=cast(StreamHealthState, stream_health),
        limit=limit,
        summary=summary,
        routes=route_items,
    )


def get_stream_runtime_stats_and_health(db: Session, stream_id: int, limit: int) -> StreamRuntimeStatsHealthBundleResponse:
    """Same payloads as separate stats + health endpoints, but one delivery_logs + routes read."""

    stream, logs, routes = _load_stream_recent_logs_and_routes(db, stream_id, limit)

    checkpoint_row = db.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).first()
    checkpoint_out: CheckpointStatsPayload | None = None
    if checkpoint_row is not None:
        checkpoint_out = CheckpointStatsPayload(
            type=checkpoint_row.checkpoint_type,
            value=checkpoint_row.checkpoint_value_json or {},
        )

    stats = StreamRuntimeStatsResponse(
        stream_id=int(stream.id),
        stream_status=str(stream.status),
        checkpoint=checkpoint_out,
        summary=_compute_summary(logs),
        last_seen=_compute_last_seen(logs),
        routes=_build_route_stats_items(routes, logs),
        recent_logs=_recent_log_items(logs),
    )
    route_items, summary = _build_route_health_items(logs, routes)
    stream_health = _compute_stream_health(logs, routes)
    health = StreamHealthResponse(
        stream_id=int(stream.id),
        stream_status=str(stream.status),
        health=cast(StreamHealthState, stream_health),
        limit=limit,
        summary=summary,
        routes=route_items,
    )
    return StreamRuntimeStatsHealthBundleResponse(stats=stats, health=health)


def _runtime_engine_status(snap: Any) -> Literal["RUNNING", "STOPPED", "DEGRADED"]:
    if not snap.schema_ready or snap.connection_error:
        return "DEGRADED"
    started = scheduler_started_at()
    if started is not None and snap.scheduler_active:
        return "RUNNING"
    if not snap.scheduler_active:
        return "STOPPED"
    return "STOPPED"


def _dashboard_summary_entity_counts(
    db: Session,
) -> tuple[int, int, int, int, int, int, int, int, int, int, int, int, int]:
    """Single round-trip per entity table for dashboard summary counts (avoids many sequential COUNTs)."""

    srow = (
        db.query(
            func.count(Stream.id),
            func.count(Stream.id).filter(Stream.status == _STREAM_STATUS_RUNNING),
            func.count(Stream.id).filter(Stream.status == _STREAM_STATUS_PAUSED),
            func.count(Stream.id).filter(Stream.status == _STREAM_STATUS_ERROR),
            func.count(Stream.id).filter(Stream.status == _STREAM_STATUS_STOPPED),
            func.count(Stream.id).filter(Stream.status == _STREAM_STATUS_RL_SOURCE),
            func.count(Stream.id).filter(Stream.status == _STREAM_STATUS_RL_DEST),
        )
        .select_from(Stream)
        .one()
    )
    total_streams = int(srow[0] or 0)
    running_streams = int(srow[1] or 0)
    paused_streams = int(srow[2] or 0)
    error_streams = int(srow[3] or 0)
    stopped_streams = int(srow[4] or 0)
    rate_limited_source_streams = int(srow[5] or 0)
    rate_limited_destination_streams = int(srow[6] or 0)

    rrow = (
        db.query(
            func.count(Route.id),
            func.count(Route.id).filter(Route.enabled.is_(True)),
        )
        .select_from(Route)
        .one()
    )
    total_routes = int(rrow[0] or 0)
    enabled_routes = int(rrow[1] or 0)
    disabled_routes = total_routes - enabled_routes

    drow = (
        db.query(
            func.count(Destination.id),
            func.count(Destination.id).filter(Destination.enabled.is_(True)),
        )
        .select_from(Destination)
        .one()
    )
    total_destinations = int(drow[0] or 0)
    enabled_destinations = int(drow[1] or 0)
    disabled_destinations = total_destinations - enabled_destinations

    return (
        total_streams,
        running_streams,
        paused_streams,
        error_streams,
        stopped_streams,
        rate_limited_source_streams,
        rate_limited_destination_streams,
        total_routes,
        enabled_routes,
        disabled_routes,
        total_destinations,
        enabled_destinations,
        disabled_destinations,
    )


def get_runtime_dashboard_summary(
    db: Session,
    limit: int,
    *,
    window: str = "1h",
) -> DashboardSummaryResponse:
    (
        total_streams,
        running_streams,
        paused_streams,
        error_streams,
        stopped_streams,
        rate_limited_source_streams,
        rate_limited_destination_streams,
        total_routes,
        enabled_routes,
        disabled_routes,
        total_destinations,
        enabled_destinations,
        disabled_destinations,
    ) = _dashboard_summary_entity_counts(db)

    td = parse_metrics_window(window)
    since = datetime.now(timezone.utc) - td
    logs = list_recent_delivery_logs_global_since(db, since=since, limit=limit)
    succ, fail, rl = _count_dashboard_log_categories(logs)

    stream_ids_in_window = {int(r.stream_id) for r in logs if r.stream_id is not None}
    stream_status_by_id: dict[int, str] = {}
    if stream_ids_in_window:
        rows = db.query(Stream.id, Stream.status).filter(Stream.id.in_(stream_ids_in_window)).all()
        stream_status_by_id = {int(r[0]): str(r[1]) for r in rows}

    summary = DashboardSummaryNumbers(
        total_streams=total_streams,
        running_streams=running_streams,
        paused_streams=paused_streams,
        error_streams=error_streams,
        stopped_streams=stopped_streams,
        rate_limited_source_streams=rate_limited_source_streams,
        rate_limited_destination_streams=rate_limited_destination_streams,
        total_routes=total_routes,
        enabled_routes=enabled_routes,
        disabled_routes=disabled_routes,
        total_destinations=total_destinations,
        enabled_destinations=enabled_destinations,
        disabled_destinations=disabled_destinations,
        recent_logs=len(logs),
        recent_successes=succ,
        recent_failures=fail,
        recent_rate_limited=rl,
    )

    snap = get_startup_snapshot()
    started = scheduler_started_at()
    uptime = scheduler_uptime_seconds()
    workers = active_worker_count()
    engine = _runtime_engine_status(snap)

    validation_operational = ValidationOperationalSummaryResponse.model_validate(
        build_validation_operational_summary(db, failures_limit=25)
    )

    return DashboardSummaryResponse(
        summary=summary,
        recent_problem_routes=_dedupe_recent_problem_routes(logs),
        recent_rate_limited_routes=_dedupe_recent_rate_limited_routes(logs),
        recent_unhealthy_streams=_dedupe_recent_unhealthy_streams(logs, stream_status_by_id),
        scheduler_started_at=started,
        scheduler_uptime_seconds=uptime,
        runtime_engine_status=engine,
        active_worker_count=workers,
        metrics_window_seconds=int(td.total_seconds()),
        validation_operational=validation_operational,
    )


def get_validation_operational_summary(db: Session) -> ValidationOperationalSummaryResponse:
    """Dedicated read-only endpoint for validation health (also embedded in dashboard summary)."""

    return ValidationOperationalSummaryResponse.model_validate(build_validation_operational_summary(db, failures_limit=50))


def get_dashboard_outcome_timeseries(
    db: Session,
    *,
    window: str = "1h",
) -> DashboardOutcomeTimeseriesResponse:
    """Dense time buckets for dashboard stacked volume chart (read-only)."""

    td = parse_metrics_window(window)
    now = datetime.now(timezone.utc)
    since = now - td
    bucket_sec = bucket_seconds_for_window(td)
    sparse = aggregate_platform_outcome_buckets(
        db,
        start_at=since,
        end_at=now,
        bucket_seconds=bucket_sec,
    )
    mb = max_buckets_for_window(td, bucket_sec)
    dense_rows = dense_platform_outcome_buckets(
        sparse,
        start_at=since,
        end_at=now,
        bucket_seconds=bucket_sec,
        max_buckets=mb,
    )
    buckets = [
        DashboardOutcomeBucket(
            bucket_start=r.bucket_start,
            success=int(r.success),
            failed=int(r.failed),
            rate_limited=int(r.rate_limited),
        )
        for r in dense_rows
    ]
    return DashboardOutcomeTimeseriesResponse(
        metrics_window_seconds=int(td.total_seconds()),
        buckets=buckets,
    )


def get_stream_runtime_timeline(
    db: Session,
    stream_id: int,
    *,
    limit: int,
    stage: str | None = None,
    level: str | None = None,
    status: str | None = None,
    route_id: int | None = None,
    destination_id: int | None = None,
) -> RuntimeTimelineResponse:
    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if stream is None:
        raise StreamNotFoundError(stream_id)

    rows = list_timeline_delivery_logs_for_stream(
        db,
        stream_id,
        limit=limit,
        stage=stage,
        level=level,
        status=status,
        route_id=route_id,
        destination_id=destination_id,
    )
    items = [_to_timeline_item(r) for r in rows]
    return RuntimeTimelineResponse(stream_id=int(stream.id), total=len(items), items=items)


def get_runtime_failure_trend(
    db: Session,
    *,
    limit: int,
    stream_id: int | None = None,
    route_id: int | None = None,
    destination_id: int | None = None,
    window: str = "1h",
) -> RuntimeFailureTrendResponse:
    td = parse_metrics_window(window)
    since = datetime.now(timezone.utc) - td
    rows = aggregate_failure_trend_buckets(
        db,
        limit=limit,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        created_at_since=since,
    )
    buckets = [
        RuntimeFailureTrendBucket(
            stage=str(r.stage),
            count=int(r.row_count),
            latest_created_at=r.latest_created_at,
            stream_id=int(r.stream_id) if r.stream_id is not None else None,
            route_id=int(r.route_id) if r.route_id is not None else None,
            destination_id=int(r.destination_id) if r.destination_id is not None else None,
            error_code=r.error_code,
        )
        for r in rows
    ]
    return RuntimeFailureTrendResponse(total=len(buckets), buckets=buckets)


def get_runtime_logs_page(
    db: Session,
    *,
    limit: int,
    stream_id: int | None = None,
    route_id: int | None = None,
    destination_id: int | None = None,
    run_id: str | None = None,
    stage: str | None = None,
    level: str | None = None,
    status: str | None = None,
    error_code: str | None = None,
    partial_success: bool | None = None,
    cursor_created_at: datetime | None = None,
    cursor_id: int | None = None,
    window: str | None = None,
) -> RuntimeLogsPageResponse:
    since: datetime | None = None
    if window is not None:
        td = parse_metrics_window(window)
        since = datetime.now(timezone.utc) - td
    rows = page_delivery_logs(
        db,
        limit=limit,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        run_id=run_id,
        stage=stage,
        level=level,
        status=status,
        error_code=error_code,
        partial_success=partial_success,
        created_at_since=since,
        cursor_created_at=cursor_created_at,
        cursor_id=cursor_id,
    )
    has_next = len(rows) > limit
    page_rows = rows[:limit]
    items = [_to_logs_page_item(r) for r in page_rows]

    next_ca: datetime | None = None
    next_i: int | None = None
    if page_rows:
        last = page_rows[-1]
        next_ca = last.created_at
        next_i = int(last.id)

    return RuntimeLogsPageResponse(
        total_returned=len(items),
        has_next=has_next,
        next_cursor_created_at=next_ca,
        next_cursor_id=next_i,
        items=items,
    )


def search_runtime_logs(
    db: Session,
    *,
    stream_id: int | None = None,
    route_id: int | None = None,
    destination_id: int | None = None,
    run_id: str | None = None,
    stage: str | None = None,
    level: str | None = None,
    status: str | None = None,
    error_code: str | None = None,
    partial_success: bool | None = None,
    limit: int = 100,
    window: str = "1h",
) -> RuntimeLogSearchResponse:
    td = parse_metrics_window(window)
    since = datetime.now(timezone.utc) - td
    rows = search_delivery_logs(
        db,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        run_id=run_id,
        stage=stage,
        level=level,
        status=status,
        error_code=error_code,
        partial_success=partial_success,
        created_at_since=since,
        limit=limit,
    )
    filters = RuntimeLogSearchFilters(
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        run_id=run_id,
        stage=stage,
        level=level,
        status=status,
        error_code=error_code,
        partial_success=partial_success,
        limit=limit,
        metrics_window_seconds=int(td.total_seconds()),
        window_start_at=since,
    )
    return RuntimeLogSearchResponse(
        total_returned=len(rows),
        filters=filters,
        logs=[_to_runtime_log_search_item(r) for r in rows],
    )


def _row_payload(row: DeliveryLog | None) -> dict[str, Any]:
    if row is None:
        return {}
    raw = row.payload_sample
    return dict(raw) if isinstance(raw, dict) else {}


def _checkpoint_after_preview(val: Any) -> str | None:
    if val is None:
        return None
    if isinstance(val, dict):
        lse = val.get("last_success_event")
        if isinstance(lse, dict):
            for k in ("event_id", "id", "@timestamp", "timestamp"):
                if k in lse:
                    return str(lse[k])[:240]
        return str(val)[:240]
    return str(val)[:240]


def _runtime_checkpoint_event_from_row(r: DeliveryLog) -> RuntimeTraceCheckpointEvent:
    ps = _row_payload(r)
    corr_raw = ps.get("correlated_route_failures")
    corr_list: list[dict[str, Any]] = []
    if isinstance(corr_raw, list):
        corr_list = [c for c in corr_raw if isinstance(c, dict)]

    def _maybe_int(key: str) -> int | None:
        v = ps.get(key)
        return int(v) if isinstance(v, int) else None

    return RuntimeTraceCheckpointEvent(
        checkpoint_type=str(ps["checkpoint_type"]) if ps.get("checkpoint_type") is not None else None,
        message=r.message,
        checkpoint_before=ps.get("checkpoint_before") if isinstance(ps.get("checkpoint_before"), dict) else None,
        checkpoint_after=ps.get("checkpoint_after") if isinstance(ps.get("checkpoint_after"), dict) else None,
        processed_events=_maybe_int("processed_events"),
        delivered_events=_maybe_int("delivered_events"),
        failed_events=_maybe_int("failed_events"),
        partial_success=bool(ps["partial_success"]) if isinstance(ps.get("partial_success"), bool) else None,
        update_reason=str(ps["update_reason"]) if isinstance(ps.get("update_reason"), str) else None,
        correlated_route_failures=corr_list,
    )


def _build_checkpoint_trace_timeline(rows: list[DeliveryLog]) -> list[CheckpointTraceTimelineNode]:
    nodes: list[CheckpointTraceTimelineNode] = []
    for r in rows:
        ps = _row_payload(r)
        if r.stage == "run_started":
            nodes.append(
                CheckpointTraceTimelineNode(
                    kind="run_started",
                    title="Run started",
                    detail="Correlation established for this execution",
                    tone="neutral",
                    created_at=r.created_at,
                    log_id=int(r.id),
                )
            )
        elif r.stage == "parse":
            ec = ps.get("extracted_event_count")
            nodes.append(
                CheckpointTraceTimelineNode(
                    kind="extract",
                    title="Events extracted",
                    detail=f"{ec} events" if ec is not None else None,
                    tone="success",
                    created_at=r.created_at,
                    log_id=int(r.id),
                )
            )
        elif r.stage == "route_send_success":
            ec = ps.get("event_count")
            nodes.append(
                CheckpointTraceTimelineNode(
                    kind="route_delivery",
                    title="Delivered batch to destination",
                    detail=f"{ec} events via route #{r.route_id}" if ec is not None else f"route #{r.route_id}",
                    tone="success",
                    created_at=r.created_at,
                    log_id=int(r.id),
                )
            )
        elif r.stage == "route_send_failed":
            nodes.append(
                CheckpointTraceTimelineNode(
                    kind="route_failure",
                    title="Destination delivery failed",
                    detail=r.message[:280] if r.message else None,
                    tone="error",
                    created_at=r.created_at,
                    log_id=int(r.id),
                )
            )
        elif r.stage == "checkpoint_update":
            preview = _checkpoint_after_preview(ps.get("checkpoint_after"))
            ur = ps.get("update_reason")
            nodes.append(
                CheckpointTraceTimelineNode(
                    kind="checkpoint_update",
                    title="Checkpoint advanced",
                    detail=f"{ur}: {preview}" if ur and preview else (preview or str(ur) if ur else None),
                    tone="warning" if ps.get("partial_success") else "success",
                    created_at=r.created_at,
                    log_id=int(r.id),
                )
            )
        elif r.stage == "run_complete":
            proc = ps.get("processed_events")
            deliv = ps.get("delivered_events")
            pend = ps.get("retry_pending")
            nodes.append(
                CheckpointTraceTimelineNode(
                    kind="run_complete",
                    title="Run completed",
                    detail=f"processed={proc} delivered={deliv}" + (f"; retry_pending={pend}" if pend else ""),
                    tone="warning" if ps.get("partial_success") else "neutral",
                    created_at=r.created_at,
                    log_id=int(r.id),
                )
            )
    return nodes


def _build_checkpoint_trace_response(db: Session, rows: list[DeliveryLog], run_id: str) -> CheckpointTraceResponse:
    if not rows:
        raise RunTraceNotFoundError(run_id)

    ck_ps = _row_payload(next((r for r in rows if r.stage == "checkpoint_update"), None))
    rc_ps = _row_payload(next((r for r in reversed(rows) if r.stage == "run_complete"), None))
    rs_ps = _row_payload(next((r for r in rows if r.stage == "run_started"), None))

    stream_id = int(rows[0].stream_id) if rows[0].stream_id is not None else None
    stream_name: str | None = None
    connector_name: str | None = None
    if stream_id is not None:
        stream_row = db.query(Stream).filter(Stream.id == stream_id).first()
        if stream_row is not None:
            stream_name = str(stream_row.name or "")
            conn_row = db.query(Connector).filter(Connector.id == int(stream_row.connector_id)).first()
            if conn_row is not None:
                connector_name = str(conn_row.name or "")

    def _merge_field(key: str) -> Any:
        if ck_ps.get(key) is not None:
            return ck_ps.get(key)
        if rc_ps.get(key) is not None:
            return rc_ps.get(key)
        return rs_ps.get(key)

    ct_raw = _merge_field("checkpoint_type")
    checkpoint_type = str(ct_raw) if ct_raw is not None else None

    before = ck_ps.get("checkpoint_before")
    if not isinstance(before, dict):
        before = rs_ps.get("checkpoint_before") if isinstance(rs_ps.get("checkpoint_before"), dict) else None
    after = ck_ps.get("checkpoint_after") if isinstance(ck_ps.get("checkpoint_after"), dict) else None
    if after is None and isinstance(rc_ps.get("checkpoint_after"), dict):
        after = rc_ps.get("checkpoint_after")

    processed = rc_ps.get("processed_events")
    delivered = rc_ps.get("delivered_events")
    failed = rc_ps.get("failed_events")
    partial = rc_ps.get("partial_success") if isinstance(rc_ps.get("partial_success"), bool) else None
    update_reason = rc_ps.get("update_reason") if isinstance(rc_ps.get("update_reason"), str) else None
    retry_pending = rc_ps.get("retry_pending") if isinstance(rc_ps.get("retry_pending"), bool) else None

    failures = [
        CheckpointTraceRouteFailureRef(
            route_id=int(r.route_id),
            destination_id=int(r.destination_id) if r.destination_id is not None else None,
            stage=str(r.stage),
            message=str(r.message or ""),
            error_code=r.error_code,
            created_at=r.created_at,
        )
        for r in rows
        if r.stage in ("route_send_failed", "route_retry_failed") and r.route_id is not None
    ]

    timeline = _build_checkpoint_trace_timeline(rows)

    return CheckpointTraceResponse(
        run_id=run_id,
        stream_id=stream_id,
        stream_name=stream_name,
        connector_name=connector_name,
        checkpoint_type=checkpoint_type,
        checkpoint_before=before if isinstance(before, dict) else None,
        checkpoint_after=after,
        processed_events=int(processed) if isinstance(processed, int) else None,
        delivered_events=int(delivered) if isinstance(delivered, int) else None,
        failed_events=int(failed) if isinstance(failed, int) else None,
        partial_success=partial,
        update_reason=update_reason,
        retry_pending=retry_pending,
        correlated_route_failures=failures,
        timeline_events=timeline,
    )


def get_checkpoint_trace_for_run(db: Session, run_id: str, *, stream_id: int | None = None) -> CheckpointTraceResponse:
    rows = list_delivery_logs_by_run_id(db, run_id, stream_id=stream_id)
    return _build_checkpoint_trace_response(db, rows, run_id)


def get_stream_checkpoint_history(db: Session, stream_id: int, *, limit: int = 50) -> CheckpointHistoryResponse:
    stream_row = db.query(Stream).filter(Stream.id == stream_id).first()
    if stream_row is None:
        raise StreamNotFoundError(stream_id)
    rows = list_checkpoint_update_logs_for_stream(db, stream_id, limit=limit)
    items: list[CheckpointHistoryItem] = []
    for r in rows:
        ps = _row_payload(r)
        prev = _checkpoint_after_preview(ps.get("checkpoint_after"))
        ps_bool = ps.get("partial_success")
        partial_opt: bool | None = bool(ps_bool) if isinstance(ps_bool, bool) else None
        ur = ps.get("update_reason")
        items.append(
            CheckpointHistoryItem(
                log_id=int(r.id),
                run_id=r.run_id,
                created_at=r.created_at,
                checkpoint_type=str(ps["checkpoint_type"]) if ps.get("checkpoint_type") is not None else None,
                update_reason=str(ur) if isinstance(ur, str) else None,
                partial_success=partial_opt,
                checkpoint_after_preview=prev,
            )
        )
    return CheckpointHistoryResponse(stream_id=stream_id, items=items)


def _assemble_runtime_trace(
    db: Session,
    *,
    timeline_rows: list[DeliveryLog],
    anchor_log_id: int | None,
    resolved_run_id: str | None,
) -> RuntimeTraceResponse:
    checkpoint_ev: RuntimeTraceCheckpointEvent | None = None
    for r in timeline_rows:
        if r.stage == "checkpoint_update":
            checkpoint_ev = _runtime_checkpoint_event_from_row(r)
            break

    timeline = [
        RuntimeTraceTimelineEntry(
            id=int(r.id),
            created_at=r.created_at,
            stage=r.stage,
            level=r.level,
            status=r.status,
            message=r.message,
            route_id=int(r.route_id) if r.route_id is not None else None,
            destination_id=int(r.destination_id) if r.destination_id is not None else None,
            latency_ms=r.latency_ms,
            retry_count=int(r.retry_count or 0),
            http_status=r.http_status,
            error_code=r.error_code,
        )
        for r in timeline_rows
    ]

    stream_id: int | None = None
    if timeline_rows:
        sid = timeline_rows[0].stream_id
        stream_id = int(sid) if sid is not None else None

    connector_ref: RuntimeTraceConnectorRef | None = None
    stream_ref: RuntimeTraceStreamRef | None = None
    routes_out: list[RuntimeTraceRouteRef] = []
    dest_out: list[RuntimeTraceDestinationRef] = []
    if stream_id is not None:
        stream_row = db.query(Stream).filter(Stream.id == stream_id).first()
        if stream_row is not None:
            stream_ref = RuntimeTraceStreamRef(id=int(stream_row.id), name=str(stream_row.name or ""))
            conn_row = db.query(Connector).filter(Connector.id == int(stream_row.connector_id)).first()
            if conn_row is not None:
                connector_ref = RuntimeTraceConnectorRef(id=int(conn_row.id), name=str(conn_row.name or ""))
            route_rows = db.query(Route).filter(Route.stream_id == stream_id).all()
            seen_dest: set[int] = set()
            for rr in route_rows:
                dest = (
                    db.query(Destination).filter(Destination.id == int(rr.destination_id)).first()
                    if rr.destination_id is not None
                    else None
                )
                dname = str(dest.name) if dest is not None and dest.name else ""
                label = f"Route #{rr.id} → {dname}" if dname else f"Route #{rr.id}"
                routes_out.append(
                    RuntimeTraceRouteRef(
                        id=int(rr.id),
                        destination_id=int(rr.destination_id) if rr.destination_id is not None else None,
                        label=label,
                    )
                )
                if dest is not None and int(dest.id) not in seen_dest:
                    seen_dest.add(int(dest.id))
                    dest_out.append(
                        RuntimeTraceDestinationRef(id=int(dest.id), name=str(dest.name or f"Destination #{dest.id}"))
                    )

    return RuntimeTraceResponse(
        run_id=resolved_run_id,
        anchor_log_id=anchor_log_id,
        stream_id=stream_id,
        connector=connector_ref,
        stream=stream_ref,
        routes=routes_out,
        destinations=dest_out,
        timeline=timeline,
        checkpoint=checkpoint_ev,
    )


def get_runtime_trace_for_delivery_log(db: Session, log_id: int) -> RuntimeTraceResponse:
    row = db.query(DeliveryLog).filter(DeliveryLog.id == log_id).first()
    if row is None:
        raise DeliveryLogNotFoundError(log_id)
    run_id = row.run_id
    stream_id = int(row.stream_id) if row.stream_id is not None else None
    if run_id:
        timeline_rows = list_delivery_logs_by_run_id(db, run_id, stream_id=stream_id)
    else:
        timeline_rows = [row]
    return _assemble_runtime_trace(
        db,
        timeline_rows=timeline_rows,
        anchor_log_id=log_id,
        resolved_run_id=run_id,
    )


def get_runtime_trace_for_run(db: Session, run_id: str) -> RuntimeTraceResponse:
    rows = list_delivery_logs_by_run_id(db, run_id, stream_id=None)
    if not rows:
        raise RunTraceNotFoundError(run_id)
    stream_id = int(rows[0].stream_id) if rows[0].stream_id is not None else None
    scoped = list_delivery_logs_by_run_id(db, run_id, stream_id=stream_id)
    return _assemble_runtime_trace(
        db,
        timeline_rows=scoped,
        anchor_log_id=None,
        resolved_run_id=run_id,
    )


def get_runtime_alert_summary(
    db: Session,
    *,
    window: str = "1h",
    limit: int = 100,
) -> RuntimeAlertSummaryResponse:
    td = parse_metrics_window(window)
    end_at = datetime.now(timezone.utc)
    start_at = end_at - td
    rows = aggregate_warn_error_summaries(db, start_at=start_at, end_at=end_at, limit=limit)
    items: list[RuntimeAlertSummaryItem] = []
    for r in rows:
        sev: Literal["WARN", "ERROR"] = "ERROR" if r.severity == "ERROR" else "WARN"
        items.append(
            RuntimeAlertSummaryItem(
                stream_id=r.stream_id,
                stream_name=r.stream_name,
                connector_name=r.connector_name,
                severity=sev,
                count=r.count,
                latest_occurrence=r.latest_occurrence,
            )
        )
    return RuntimeAlertSummaryResponse(metrics_window_seconds=int(td.total_seconds()), items=items)


def get_mapping_ui_config(db: Session, stream_id: int) -> MappingUIConfigResponse:
    stream = db.query(Stream).options(joinedload(Stream.source)).filter(Stream.id == stream_id).first()
    if stream is None:
        raise StreamNotFoundError(stream_id)

    source = stream.source
    source_id = int(source.id) if source is not None else int(stream.source_id)
    source_type = str(source.source_type) if source is not None else ""
    source_config = dict(source.config_json or {}) if source is not None else {}

    mapping = db.query(Mapping).filter(Mapping.stream_id == stream_id).first()
    if mapping is None:
        mapping_out = MappingUIConfigMapping(
            exists=False,
            event_array_path=None,
            event_root_path=None,
            field_mappings={},
            raw_payload_mode=None,
        )
    else:
        mapping_out = MappingUIConfigMapping(
            exists=True,
            event_array_path=mapping.event_array_path,
            event_root_path=mapping.event_root_path,
            field_mappings={str(k): str(v) for k, v in (mapping.field_mappings_json or {}).items()},
            raw_payload_mode=mapping.raw_payload_mode,
        )

    enrichment = db.query(Enrichment).filter(Enrichment.stream_id == stream_id).first()
    if enrichment is None:
        enrichment_out = MappingUIConfigEnrichment(
            exists=False,
            enabled=False,
            enrichment={},
            override_policy=None,
        )
    else:
        enrichment_out = MappingUIConfigEnrichment(
            exists=True,
            enabled=bool(enrichment.enabled),
            enrichment=dict(enrichment.enrichment_json or {}),
            override_policy=str(enrichment.override_policy),
        )

    routes = (
        db.query(Route)
        .options(joinedload(Route.destination))
        .filter(Route.stream_id == stream_id)
        .order_by(Route.id.asc())
        .all()
    )
    route_items: list[MappingUIConfigRouteItem] = []
    for route in routes:
        destination = route.destination
        route_items.append(
            MappingUIConfigRouteItem(
                route_id=int(route.id),
                destination_id=int(route.destination_id),
                destination_name=str(destination.name) if destination is not None else None,
                destination_type=str(destination.destination_type) if destination is not None else None,
                route_enabled=bool(route.enabled),
                destination_enabled=bool(destination.enabled) if destination is not None else False,
                formatter_config=dict(route.formatter_config_json or {}),
                route_rate_limit=dict(route.rate_limit_json or {}),
                failure_policy=str(route.failure_policy),
            )
        )

    return MappingUIConfigResponse(
        stream_id=int(stream.id),
        stream_name=str(stream.name),
        stream_enabled=bool(stream.enabled),
        stream_status=str(stream.status),
        source_id=source_id,
        source_type=source_type,
        source_config=mask_secrets(source_config),
        mapping=mapping_out,
        enrichment=enrichment_out,
        routes=route_items,
        message="Mapping UI config loaded successfully",
    )


def get_route_ui_config(db: Session, route_id: int) -> RouteUIConfigResponse:
    route = db.query(Route).options(joinedload(Route.destination)).filter(Route.id == route_id).first()
    if route is None:
        raise RouteNotFoundError(route_id)

    destination = route.destination
    destination_config = dict(destination.config_json or {}) if destination is not None else {}
    route_formatter = dict(route.formatter_config_json or {})
    dest_type = str(destination.destination_type or "").strip().upper() if destination is not None else ""
    effective_formatter = (
        resolve_formatter_config(destination_config, route_formatter or None)
        if destination is not None
        else dict(route_formatter)
    )
    effective_formatter = {
        **effective_formatter,
        "message_prefix_enabled": effective_message_prefix_enabled(route_formatter, dest_type),
        "message_prefix_template": effective_message_prefix_template(route_formatter),
    }
    route_rate_limit = dict(route.rate_limit_json or {})
    effective_rate_limit = route_rate_limit if route_rate_limit else dict(destination.rate_limit_json or {}) if destination is not None else {}

    return RouteUIConfigResponse(
        route=RouteUIConfigRoute(
            id=int(route.id),
            stream_id=int(route.stream_id),
            destination_id=int(route.destination_id),
            enabled=bool(route.enabled),
            failure_policy=str(route.failure_policy),
            formatter_config_json=route_formatter,
            rate_limit_json=route_rate_limit,
        ),
        destination=RouteUIConfigDestination(
            id=int(destination.id) if destination is not None else None,
            name=str(destination.name) if destination is not None else None,
            destination_type=str(destination.destination_type) if destination is not None else None,
            enabled=bool(destination.enabled) if destination is not None else False,
            config_json=destination_config,
            rate_limit_json=dict(destination.rate_limit_json or {}) if destination is not None else {},
        ),
        effective_formatter_config=effective_formatter,
        effective_rate_limit=effective_rate_limit,
        message="Route UI config loaded successfully",
    )


def get_destination_ui_config(db: Session, destination_id: int) -> DestinationUIConfigResponse:
    destination = db.query(Destination).filter(Destination.id == destination_id).first()
    if destination is None:
        raise DestinationNotFoundError(destination_id)

    routes = (
        db.query(Route)
        .options(joinedload(Route.stream))
        .filter(Route.destination_id == destination_id)
        .order_by(Route.id.asc())
        .all()
    )
    route_items: list[DestinationUIConfigRouteItem] = []
    for route in routes:
        stream = route.stream
        route_items.append(
            DestinationUIConfigRouteItem(
                id=int(route.id),
                stream_id=int(route.stream_id),
                stream_name=str(stream.name) if stream is not None else None,
                enabled=bool(route.enabled),
                failure_policy=str(route.failure_policy),
                formatter_config_json=dict(route.formatter_config_json or {}),
                rate_limit_json=dict(route.rate_limit_json or {}),
            )
        )

    return DestinationUIConfigResponse(
        destination=DestinationUIConfigDestination(
            id=int(destination.id),
            name=str(destination.name),
            destination_type=str(destination.destination_type),
            enabled=bool(destination.enabled),
            config_json=dict(destination.config_json or {}),
            rate_limit_json=dict(destination.rate_limit_json or {}),
        ),
        routes=route_items,
        message="Destination UI config loaded successfully",
    )


def get_stream_ui_config(db: Session, stream_id: int) -> StreamUIConfigResponse:
    stream = (
        db.query(Stream)
        .options(joinedload(Stream.source))
        .filter(Stream.id == stream_id)
        .first()
    )
    if stream is None:
        raise StreamNotFoundError(stream_id)

    source = stream.source
    mapping = db.query(Mapping).filter(Mapping.stream_id == stream_id).first()
    enrichment = db.query(Enrichment).filter(Enrichment.stream_id == stream_id).first()
    route_rows = (
        db.query(Route)
        .options(joinedload(Route.destination))
        .filter(Route.stream_id == stream_id)
        .order_by(Route.id.asc())
        .all()
    )

    routes: list[StreamUIConfigRouteSummary] = []
    for route in route_rows:
        destination = route.destination
        routes.append(
            StreamUIConfigRouteSummary(
                id=int(route.id),
                destination_id=int(route.destination_id),
                destination_name=str(destination.name) if destination is not None else None,
                destination_type=str(destination.destination_type) if destination is not None else None,
                enabled=bool(route.enabled),
                destination_enabled=bool(destination.enabled) if destination is not None else False,
                failure_policy=str(route.failure_policy),
            )
        )

    return StreamUIConfigResponse(
        stream=StreamUIConfigStream(
            id=int(stream.id),
            connector_id=int(stream.connector_id),
            source_id=int(stream.source_id),
            name=str(stream.name),
            stream_type=str(stream.stream_type),
            enabled=bool(stream.enabled),
            status=str(stream.status),
            polling_interval=int(stream.polling_interval),
            config_json=dict(stream.config_json or {}),
            rate_limit_json=dict(stream.rate_limit_json or {}),
        ),
        source=StreamUIConfigSourceSummary(
            id=int(source.id) if source is not None else None,
            source_type=str(source.source_type) if source is not None else None,
            enabled=bool(source.enabled) if source is not None else False,
            config_json=dict(source.config_json or {}) if source is not None else {},
        ),
        mapping=StreamUIConfigMappingSummary(
            exists=mapping is not None,
            event_array_path=mapping.event_array_path if mapping is not None else None,
            event_root_path=mapping.event_root_path if mapping is not None else None,
            raw_payload_mode=mapping.raw_payload_mode if mapping is not None else None,
        ),
        enrichment=StreamUIConfigEnrichmentSummary(
            exists=enrichment is not None,
            enabled=bool(enrichment.enabled) if enrichment is not None else False,
            override_policy=str(enrichment.override_policy) if enrichment is not None else None,
        ),
        routes=routes,
        message="Stream UI config loaded successfully",
    )


def get_source_ui_config(db: Session, source_id: int) -> SourceUIConfigResponse:
    source = (
        db.query(Source)
        .options(joinedload(Source.streams))
        .filter(Source.id == source_id)
        .first()
    )
    if source is None:
        raise SourceNotFoundError(source_id)

    stream_rows = (
        db.query(Stream)
        .filter(Stream.source_id == source_id)
        .order_by(Stream.id.asc())
        .all()
    )
    route_counts_rows = (
        db.query(Route.stream_id, func.count(Route.id))
        .filter(Route.stream_id.in_([s.id for s in stream_rows]))
        .group_by(Route.stream_id)
        .all()
        if stream_rows
        else []
    )
    route_count_by_stream = {int(stream_id): int(cnt) for stream_id, cnt in route_counts_rows}

    streams: list[SourceUIConfigStreamItem] = []
    for stream in stream_rows:
        streams.append(
            SourceUIConfigStreamItem(
                id=int(stream.id),
                name=str(stream.name),
                stream_type=str(stream.stream_type),
                enabled=bool(stream.enabled),
                status=str(stream.status),
                polling_interval=int(stream.polling_interval),
                config_json=dict(stream.config_json or {}),
                rate_limit_json=dict(stream.rate_limit_json or {}),
                route_count=route_count_by_stream.get(int(stream.id), 0),
            )
        )

    return SourceUIConfigResponse(
        source=SourceUIConfigSource(
            id=int(source.id),
            connector_id=int(source.connector_id),
            source_type=str(source.source_type),
            enabled=bool(source.enabled),
            config_json=mask_secrets(dict(source.config_json or {})),
            auth_json=mask_secrets(dict(source.auth_json or {})),
        ),
        streams=streams,
        message="Source UI config loaded successfully",
    )


def get_connector_ui_config(db: Session, connector_id: int) -> ConnectorUIConfigResponse:
    connector = db.query(Connector).filter(Connector.id == connector_id).first()
    if connector is None:
        raise ConnectorNotFoundError(connector_id)

    source_rows = (
        db.query(Source)
        .filter(Source.connector_id == connector_id)
        .order_by(Source.id.asc())
        .all()
    )
    stream_rows = (
        db.query(Stream)
        .filter(Stream.connector_id == connector_id)
        .order_by(Stream.id.asc())
        .all()
    )

    stream_count_by_source: dict[int, int] = {}
    if source_rows:
        counts = (
            db.query(Stream.source_id, func.count(Stream.id))
            .filter(Stream.connector_id == connector_id)
            .group_by(Stream.source_id)
            .all()
        )
        stream_count_by_source = {int(source_id): int(cnt) for source_id, cnt in counts}

    route_count_by_stream: dict[int, int] = {}
    if stream_rows:
        counts = (
            db.query(Route.stream_id, func.count(Route.id))
            .filter(Route.stream_id.in_([stream.id for stream in stream_rows]))
            .group_by(Route.stream_id)
            .all()
        )
        route_count_by_stream = {int(stream_id): int(cnt) for stream_id, cnt in counts}

    sources: list[ConnectorUIConfigSourceSummary] = []
    for source in source_rows:
        sources.append(
            ConnectorUIConfigSourceSummary(
                id=int(source.id),
                source_type=str(source.source_type),
                enabled=bool(source.enabled),
                stream_count=stream_count_by_source.get(int(source.id), 0),
            )
        )

    streams: list[ConnectorUIConfigStreamSummary] = []
    for stream in stream_rows:
        streams.append(
            ConnectorUIConfigStreamSummary(
                id=int(stream.id),
                source_id=int(stream.source_id),
                name=str(stream.name),
                stream_type=str(stream.stream_type),
                enabled=bool(stream.enabled),
                status=str(stream.status),
                polling_interval=int(stream.polling_interval),
                route_count=route_count_by_stream.get(int(stream.id), 0),
            )
        )

    return ConnectorUIConfigResponse(
        connector=ConnectorUIConfigConnector(
            id=int(connector.id),
            name=str(connector.name),
            description=connector.description,
            status=str(connector.status),
        ),
        sources=sources,
        streams=streams,
        summary=ConnectorUIConfigSummary(
            source_count=len(sources),
            stream_count=len(streams),
            enabled_stream_count=sum(1 for stream in streams if stream.enabled),
            route_count=sum(stream.route_count for stream in streams),
        ),
        message="Connector UI config loaded successfully",
    )
