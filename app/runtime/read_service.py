"""Read-only aggregation for runtime stats, health, dashboard, and log search (no DB writes)."""

from __future__ import annotations

from datetime import datetime
from typing import cast

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.checkpoints.models import Checkpoint
from app.destinations.models import Destination
from app.logs.models import DeliveryLog
from app.logs.repository import (
    aggregate_failure_trend_buckets,
    list_recent_delivery_logs_for_stream,
    list_recent_delivery_logs_global,
    list_timeline_delivery_logs_for_stream,
    page_delivery_logs,
    search_delivery_logs,
)
from app.routes.models import Route
from app.runtime.schemas import (
    CheckpointStatsPayload,
    DashboardSummaryNumbers,
    DashboardSummaryResponse,
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
    RuntimeTimelineItem,
    RuntimeTimelineResponse,
    StreamHealthResponse,
    StreamHealthState,
    StreamHealthSummary,
    StreamRuntimeLastSeen,
    StreamRuntimeStatsResponse,
    StreamRuntimeSummary,
)
from app.streams.models import Stream


class StreamNotFoundError(Exception):
    """Raised when stream_id is missing; router maps this to HTTP 404 STREAM_NOT_FOUND."""

    def __init__(self, stream_id: int) -> None:
        super().__init__(stream_id)
        self.stream_id = stream_id


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


def get_stream_runtime_stats(db: Session, stream_id: int, limit: int) -> StreamRuntimeStatsResponse:
    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if stream is None:
        raise StreamNotFoundError(stream_id)

    checkpoint_row = db.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).first()
    checkpoint_out: CheckpointStatsPayload | None = None
    if checkpoint_row is not None:
        checkpoint_out = CheckpointStatsPayload(
            type=checkpoint_row.checkpoint_type,
            value=checkpoint_row.checkpoint_value_json or {},
        )

    logs = list_recent_delivery_logs_for_stream(db, stream_id, limit=limit)

    routes = (
        db.query(Route)
        .options(joinedload(Route.destination))
        .filter(Route.stream_id == stream_id)
        .order_by(Route.id.asc())
        .all()
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


def get_runtime_dashboard_summary(db: Session, limit: int) -> DashboardSummaryResponse:
    total_streams = int(db.query(func.count(Stream.id)).scalar() or 0)
    running_streams = int(
        db.query(func.count(Stream.id)).filter(Stream.status == _STREAM_STATUS_RUNNING).scalar() or 0
    )
    paused_streams = int(
        db.query(func.count(Stream.id)).filter(Stream.status == _STREAM_STATUS_PAUSED).scalar() or 0
    )
    error_streams = int(
        db.query(func.count(Stream.id)).filter(Stream.status == _STREAM_STATUS_ERROR).scalar() or 0
    )
    stopped_streams = int(
        db.query(func.count(Stream.id)).filter(Stream.status == _STREAM_STATUS_STOPPED).scalar() or 0
    )
    rate_limited_source_streams = int(
        db.query(func.count(Stream.id)).filter(Stream.status == _STREAM_STATUS_RL_SOURCE).scalar() or 0
    )
    rate_limited_destination_streams = int(
        db.query(func.count(Stream.id)).filter(Stream.status == _STREAM_STATUS_RL_DEST).scalar() or 0
    )

    total_routes = int(db.query(func.count(Route.id)).scalar() or 0)
    enabled_routes = int(db.query(func.count(Route.id)).filter(Route.enabled.is_(True)).scalar() or 0)
    disabled_routes = total_routes - enabled_routes

    total_destinations = int(db.query(func.count(Destination.id)).scalar() or 0)
    enabled_destinations = int(
        db.query(func.count(Destination.id)).filter(Destination.enabled.is_(True)).scalar() or 0
    )
    disabled_destinations = total_destinations - enabled_destinations

    logs = list_recent_delivery_logs_global(db, limit=limit)
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

    return DashboardSummaryResponse(
        summary=summary,
        recent_problem_routes=_dedupe_recent_problem_routes(logs),
        recent_rate_limited_routes=_dedupe_recent_rate_limited_routes(logs),
        recent_unhealthy_streams=_dedupe_recent_unhealthy_streams(logs, stream_status_by_id),
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
) -> RuntimeFailureTrendResponse:
    rows = aggregate_failure_trend_buckets(
        db,
        limit=limit,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
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
    stage: str | None = None,
    level: str | None = None,
    status: str | None = None,
    error_code: str | None = None,
    cursor_created_at: datetime | None = None,
    cursor_id: int | None = None,
) -> RuntimeLogsPageResponse:
    rows = page_delivery_logs(
        db,
        limit=limit,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        stage=stage,
        level=level,
        status=status,
        error_code=error_code,
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
    stage: str | None = None,
    level: str | None = None,
    status: str | None = None,
    error_code: str | None = None,
    limit: int = 100,
) -> RuntimeLogSearchResponse:
    rows = search_delivery_logs(
        db,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        stage=stage,
        level=level,
        status=status,
        error_code=error_code,
        limit=limit,
    )
    filters = RuntimeLogSearchFilters(
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        stage=stage,
        level=level,
        status=status,
        error_code=error_code,
        limit=limit,
    )
    return RuntimeLogSearchResponse(
        total_returned=len(rows),
        filters=filters,
        logs=[_to_runtime_log_search_item(r) for r in rows],
    )
