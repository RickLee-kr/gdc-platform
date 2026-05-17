"""Deterministic operational health scoring (read-only).

See ``health_scoring_model`` for canonical level semantics and the two explicit
models: ``current_runtime`` (live posture) vs ``historical_analytics`` (full window).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Iterable

from sqlalchemy.orm import Session

from app.runtime import health_repository as repo
from app.runtime.analytics_schemas import AnalyticsScopeFilters, AnalyticsTimeWindow
from app.runtime.analytics_service import resolve_analytics_window
from app.runtime.health_schemas import (
    DestinationHealthListResponse,
    DestinationHealthRow,
    HealthFactor,
    HealthLevel,
    HealthLevelBreakdown,
    HealthMetrics,
    HealthOverviewResponse,
    HealthScore,
    RouteHealthDetailResponse,
    RouteHealthListResponse,
    RouteHealthRow,
    ScoringMode,
    StreamHealthDetailResponse,
    StreamHealthListResponse,
    StreamHealthRow,
)
from app.runtime.health_scoring_model import (
    OutcomeAggregate,
    compute_health_score_for_mode,
    resolve_recent_posture_window,
)
from app.runtime.read_service import RouteNotFoundError, StreamNotFoundError

LEVEL_HEALTHY: HealthLevel = "HEALTHY"
LEVEL_DEGRADED: HealthLevel = "DEGRADED"
LEVEL_UNHEALTHY: HealthLevel = "UNHEALTHY"
LEVEL_CRITICAL: HealthLevel = "CRITICAL"


@dataclass(frozen=True)
class _Aggregate:
    failure_count: int
    success_count: int
    retry_event_count: int
    retry_count_sum: int
    rate_limit_count: int
    latency_ms_avg: float | None
    latency_ms_p95: float | None
    last_failure_at: datetime | None
    last_success_at: datetime | None


def _aggregate_from_dict(d: dict) -> _Aggregate:
    return _Aggregate(
        failure_count=int(d.get("failure_count") or 0),
        success_count=int(d.get("success_count") or 0),
        retry_event_count=int(d.get("retry_event_count") or 0),
        retry_count_sum=int(d.get("retry_count_sum") or 0),
        rate_limit_count=int(d.get("rate_limit_count") or 0),
        latency_ms_avg=d.get("latency_ms_avg"),
        latency_ms_p95=d.get("latency_ms_p95"),
        last_failure_at=d.get("last_failure_at"),
        last_success_at=d.get("last_success_at"),
    )


def _to_outcome_aggregate(agg: _Aggregate) -> OutcomeAggregate:
    return OutcomeAggregate(
        failure_count=agg.failure_count,
        success_count=agg.success_count,
        retry_event_count=agg.retry_event_count,
        retry_count_sum=agg.retry_count_sum,
        rate_limit_count=agg.rate_limit_count,
        latency_ms_avg=agg.latency_ms_avg,
        latency_ms_p95=agg.latency_ms_p95,
        last_failure_at=agg.last_failure_at,
        last_success_at=agg.last_success_at,
    )


def _empty_aggregate() -> _Aggregate:
    return _Aggregate(
        failure_count=0,
        success_count=0,
        retry_event_count=0,
        retry_count_sum=0,
        rate_limit_count=0,
        latency_ms_avg=None,
        latency_ms_p95=None,
        last_failure_at=None,
        last_success_at=None,
    )


def _score_to_level(score: int) -> HealthLevel:
    if score >= 90:
        return LEVEL_HEALTHY
    if score >= 70:
        return LEVEL_DEGRADED
    if score >= 40:
        return LEVEL_UNHEALTHY
    return LEVEL_CRITICAL


def compute_health_score(
    agg: _Aggregate,
    *,
    include_latency: bool,
    scoring_mode: ScoringMode = "historical_analytics",
) -> HealthScore:
    """Public scoring entrypoint (deterministic). Defaults to historical for unit tests."""

    full = _to_outcome_aggregate(agg)
    return compute_health_score_for_mode(
        full,
        full,
        scoring_mode=scoring_mode,
        include_latency=include_latency,
    )


def _compute_entity_score(
    agg_full: _Aggregate,
    agg_recent: _Aggregate,
    *,
    scoring_mode: ScoringMode,
    include_latency: bool,
    recent_window_since: datetime | None = None,
    recent_window_until: datetime | None = None,
) -> HealthScore:
    return compute_health_score_for_mode(
        _to_outcome_aggregate(agg_full),
        _to_outcome_aggregate(agg_recent),
        scoring_mode=scoring_mode,
        include_latency=include_latency,
        recent_window_since=recent_window_since,
        recent_window_until=recent_window_until,
    )


def _fetch_dual_aggregates_for_stream(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int,
    route_id: int | None,
    destination_id: int | None,
) -> tuple[_Aggregate, _Aggregate]:
    recent_since, _ = resolve_recent_posture_window(since, until)
    full_rows = repo.fetch_stream_health_aggregates(
        db,
        since=since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    recent_rows = repo.fetch_stream_health_aggregates(
        db,
        since=recent_since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    agg_full = _empty_aggregate()
    agg_recent = _empty_aggregate()
    for row in full_rows:
        d = repo.normalize_aggregate_row(row)
        if d.get("group_id") == stream_id:
            agg_full = _aggregate_from_dict(d)
            break
    for row in recent_rows:
        d = repo.normalize_aggregate_row(row)
        if d.get("group_id") == stream_id:
            agg_recent = _aggregate_from_dict(d)
            break
    return agg_full, agg_recent


def _fetch_dual_aggregates_for_route(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    route_id: int,
    stream_id: int | None,
    destination_id: int | None,
) -> tuple[_Aggregate, _Aggregate, int | None, int | None]:
    recent_since, _ = resolve_recent_posture_window(since, until)
    full_rows = repo.fetch_route_health_aggregates(
        db,
        since=since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    recent_rows = repo.fetch_route_health_aggregates(
        db,
        since=recent_since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    agg_full = _empty_aggregate()
    agg_recent = _empty_aggregate()
    sid: int | None = None
    did: int | None = None
    for row in full_rows:
        d = repo.normalize_aggregate_row(row)
        if d.get("group_id") == route_id:
            agg_full = _aggregate_from_dict(d)
            sid = int(row.stream_id) if row.stream_id is not None else None
            did = int(row.destination_id) if row.destination_id is not None else None
            break
    for row in recent_rows:
        d = repo.normalize_aggregate_row(row)
        if d.get("group_id") == route_id:
            agg_recent = _aggregate_from_dict(d)
            break
    return agg_full, agg_recent, sid, did


def _level_breakdown(scores: Iterable[int]) -> HealthLevelBreakdown:
    counts = {LEVEL_HEALTHY: 0, LEVEL_DEGRADED: 0, LEVEL_UNHEALTHY: 0, LEVEL_CRITICAL: 0}
    for s in scores:
        counts[_score_to_level(int(s))] += 1
    return HealthLevelBreakdown(
        healthy=counts[LEVEL_HEALTHY],
        degraded=counts[LEVEL_DEGRADED],
        unhealthy=counts[LEVEL_UNHEALTHY],
        critical=counts[LEVEL_CRITICAL],
    )


def _avg_score(scores: list[int]) -> float | None:
    if not scores:
        return None
    return round(sum(scores) / len(scores), 2)


def _normalize_scoring_mode(mode: str | None) -> ScoringMode:
    if mode == "historical_analytics":
        return "historical_analytics"
    return "current_runtime"


def list_stream_health(
    db: Session,
    *,
    window: str | None,
    since: datetime | None,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    scoring_mode: str | None = None,
) -> StreamHealthListResponse:
    mode = _normalize_scoring_mode(scoring_mode)
    token, start, until = resolve_analytics_window(window=window, since=since)
    recent_since, recent_until = resolve_recent_posture_window(start, until)
    rows = repo.fetch_stream_health_aggregates(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    recent_rows = repo.fetch_stream_health_aggregates(
        db,
        since=recent_since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    recent_by_id = {
        int(r.group_id): _aggregate_from_dict(repo.normalize_aggregate_row(r))
        for r in recent_rows
        if r.group_id is not None
    }
    sids = [int(r.group_id) for r in rows if r.group_id is not None]
    lookup = repo.fetch_stream_lookup(db, sids)
    items: list[StreamHealthRow] = []
    for row in rows:
        if row.group_id is None:
            continue
        sid = int(row.group_id)
        agg_full = _aggregate_from_dict(repo.normalize_aggregate_row(row))
        agg_recent = recent_by_id.get(sid, _empty_aggregate())
        score = _compute_entity_score(
            agg_full,
            agg_recent,
            scoring_mode=mode,
            include_latency=False,
            recent_window_since=recent_since,
            recent_window_until=recent_until,
        )
        name, conn_id = lookup.get(sid, (None, None))
        items.append(
            StreamHealthRow(
                stream_id=sid,
                stream_name=name,
                connector_id=conn_id,
                score=score.score,
                level=score.level,
                factors=score.factors,
                metrics=score.metrics,
            )
        )
    items.sort(key=lambda r: (r.score, r.stream_id))
    return StreamHealthListResponse(
        time=AnalyticsTimeWindow(window=token, since=start, until=until),
        filters=AnalyticsScopeFilters(
            stream_id=stream_id, route_id=route_id, destination_id=destination_id
        ),
        scoring_mode=mode,
        rows=items,
    )


def list_route_health(
    db: Session,
    *,
    window: str | None,
    since: datetime | None,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    scoring_mode: str | None = None,
) -> RouteHealthListResponse:
    mode = _normalize_scoring_mode(scoring_mode)
    token, start, until = resolve_analytics_window(window=window, since=since)
    recent_since, recent_until = resolve_recent_posture_window(start, until)
    rows = repo.fetch_route_health_aggregates(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    recent_rows = repo.fetch_route_health_aggregates(
        db,
        since=recent_since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    recent_by_id = {
        int(r.group_id): _aggregate_from_dict(repo.normalize_aggregate_row(r))
        for r in recent_rows
        if r.group_id is not None
    }
    items: list[RouteHealthRow] = []
    for row in rows:
        if row.group_id is None:
            continue
        rid = int(row.group_id)
        agg_full = _aggregate_from_dict(repo.normalize_aggregate_row(row))
        agg_recent = recent_by_id.get(rid, _empty_aggregate())
        score = _compute_entity_score(
            agg_full,
            agg_recent,
            scoring_mode=mode,
            include_latency=True,
            recent_window_since=recent_since,
            recent_window_until=recent_until,
        )
        items.append(
            RouteHealthRow(
                route_id=rid,
                stream_id=int(row.stream_id) if row.stream_id is not None else None,
                destination_id=int(row.destination_id) if row.destination_id is not None else None,
                score=score.score,
                level=score.level,
                factors=score.factors,
                metrics=score.metrics,
            )
        )
    items.sort(key=lambda r: (r.score, r.route_id))
    return RouteHealthListResponse(
        time=AnalyticsTimeWindow(window=token, since=start, until=until),
        filters=AnalyticsScopeFilters(
            stream_id=stream_id, route_id=route_id, destination_id=destination_id
        ),
        scoring_mode=mode,
        rows=items,
    )


def list_destination_health(
    db: Session,
    *,
    window: str | None,
    since: datetime | None,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    scoring_mode: str | None = None,
) -> DestinationHealthListResponse:
    mode = _normalize_scoring_mode(scoring_mode)
    token, start, until = resolve_analytics_window(window=window, since=since)
    recent_since, recent_until = resolve_recent_posture_window(start, until)
    rows = repo.fetch_destination_health_aggregates(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    recent_rows = repo.fetch_destination_health_aggregates(
        db,
        since=recent_since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    recent_by_id = {
        int(r.group_id): _aggregate_from_dict(repo.normalize_aggregate_row(r))
        for r in recent_rows
        if r.group_id is not None
    }
    dids = [int(r.group_id) for r in rows if r.group_id is not None]
    lookup = repo.fetch_destination_lookup(db, dids)
    items: list[DestinationHealthRow] = []
    for row in rows:
        if row.group_id is None:
            continue
        did = int(row.group_id)
        agg_full = _aggregate_from_dict(repo.normalize_aggregate_row(row))
        agg_recent = recent_by_id.get(did, _empty_aggregate())
        score = _compute_entity_score(
            agg_full,
            agg_recent,
            scoring_mode=mode,
            include_latency=True,
            recent_window_since=recent_since,
            recent_window_until=recent_until,
        )
        name, dtype = lookup.get(did, (None, None))
        items.append(
            DestinationHealthRow(
                destination_id=did,
                destination_name=name,
                destination_type=dtype,
                score=score.score,
                level=score.level,
                factors=score.factors,
                metrics=score.metrics,
            )
        )
    items.sort(key=lambda r: (r.score, r.destination_id))
    return DestinationHealthListResponse(
        time=AnalyticsTimeWindow(window=token, since=start, until=until),
        filters=AnalyticsScopeFilters(
            stream_id=stream_id, route_id=route_id, destination_id=destination_id
        ),
        scoring_mode=mode,
        rows=items,
    )


def get_health_overview(
    db: Session,
    *,
    window: str | None,
    since: datetime | None,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    worst_limit: int = 5,
    scoring_mode: str | None = None,
) -> HealthOverviewResponse:
    mode = _normalize_scoring_mode(scoring_mode)
    streams = list_stream_health(
        db,
        window=window,
        since=since,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        scoring_mode=mode,
    )
    routes = list_route_health(
        db,
        window=window,
        since=since,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        scoring_mode=mode,
    )
    destinations = list_destination_health(
        db,
        window=window,
        since=since,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        scoring_mode=mode,
    )

    s_scores = [r.score for r in streams.rows]
    r_scores = [r.score for r in routes.rows]
    d_scores = [r.score for r in destinations.rows]

    worst_n = max(1, min(int(worst_limit), 25))

    return HealthOverviewResponse(
        time=streams.time,
        filters=streams.filters,
        scoring_mode=mode,
        streams=_level_breakdown(s_scores),
        routes=_level_breakdown(r_scores),
        destinations=_level_breakdown(d_scores),
        average_stream_score=_avg_score(s_scores),
        average_route_score=_avg_score(r_scores),
        average_destination_score=_avg_score(d_scores),
        worst_routes=routes.rows[:worst_n],
        worst_streams=streams.rows[:worst_n],
        worst_destinations=destinations.rows[:worst_n],
    )


def get_stream_health_detail(
    db: Session,
    *,
    stream_id: int,
    window: str | None,
    since: datetime | None,
    route_id: int | None,
    destination_id: int | None,
    scoring_mode: str | None = None,
) -> StreamHealthDetailResponse:
    stream = repo.fetch_stream_record(db, stream_id)
    if stream is None:
        raise StreamNotFoundError(stream_id)
    mode = _normalize_scoring_mode(scoring_mode)
    token, start, until = resolve_analytics_window(window=window, since=since)
    recent_since, recent_until = resolve_recent_posture_window(start, until)
    agg_full, agg_recent = _fetch_dual_aggregates_for_stream(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    score = _compute_entity_score(
        agg_full,
        agg_recent,
        scoring_mode=mode,
        include_latency=False,
        recent_window_since=recent_since,
        recent_window_until=recent_until,
    )
    return StreamHealthDetailResponse(
        time=AnalyticsTimeWindow(window=token, since=start, until=until),
        filters=AnalyticsScopeFilters(
            stream_id=stream_id, route_id=route_id, destination_id=destination_id
        ),
        stream_id=stream_id,
        stream_name=stream.name,
        connector_id=stream.connector_id,
        score=score,
    )


def get_route_health_detail(
    db: Session,
    *,
    route_id: int,
    window: str | None,
    since: datetime | None,
    stream_id: int | None,
    destination_id: int | None,
    scoring_mode: str | None = None,
) -> RouteHealthDetailResponse:
    route = repo.fetch_route_record(db, route_id)
    if route is None:
        raise RouteNotFoundError(route_id)
    mode = _normalize_scoring_mode(scoring_mode)
    token, start, until = resolve_analytics_window(window=window, since=since)
    recent_since, recent_until = resolve_recent_posture_window(start, until)
    agg_full, agg_recent, sid_from_logs, did_from_logs = _fetch_dual_aggregates_for_route(
        db,
        since=start,
        until=until,
        route_id=route_id,
        stream_id=stream_id,
        destination_id=destination_id,
    )
    score = _compute_entity_score(
        agg_full,
        agg_recent,
        scoring_mode=mode,
        include_latency=True,
        recent_window_since=recent_since,
        recent_window_until=recent_until,
    )
    return RouteHealthDetailResponse(
        time=AnalyticsTimeWindow(window=token, since=start, until=until),
        filters=AnalyticsScopeFilters(
            stream_id=stream_id, route_id=route_id, destination_id=destination_id
        ),
        route_id=route_id,
        stream_id=sid_from_logs if sid_from_logs is not None else route.stream_id,
        destination_id=did_from_logs if did_from_logs is not None else route.destination_id,
        score=score,
    )


__all__ = [
    "_Aggregate",
    "compute_health_score",
    "get_health_overview",
    "get_route_health_detail",
    "get_stream_health_detail",
    "list_destination_health",
    "list_route_health",
    "list_stream_health",
]
