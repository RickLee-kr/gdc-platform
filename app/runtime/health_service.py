"""Deterministic operational health scoring (read-only).

The scoring model is intentionally simple and explainable: each contributing
operational signal applies a fixed penalty against a baseline of 100. There is
no machine learning. The same inputs always yield the same score.

Factors:

- ``failure_rate`` — failures / (failures + successes) over outcome stages.
- ``retry_rate`` — retry-stage events / total outcome events.
- ``inactivity`` — failures occurred but no successful delivery in window.
- ``repeated_failures`` — large absolute failure counts.
- ``rate_limit_pressure`` — destination/source rate-limit hits in window.
- ``latency_p95`` — slow tail latency on delivery outcomes (Routes/Destinations).

Levels:

- ``HEALTHY`` (>= 90)
- ``DEGRADED`` (70..89)
- ``UNHEALTHY`` (40..69)
- ``CRITICAL`` (< 40)
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
    StreamHealthDetailResponse,
    StreamHealthListResponse,
    StreamHealthRow,
)
from app.runtime.read_service import RouteNotFoundError, StreamNotFoundError

LEVEL_HEALTHY: HealthLevel = "HEALTHY"
LEVEL_DEGRADED: HealthLevel = "DEGRADED"
LEVEL_UNHEALTHY: HealthLevel = "UNHEALTHY"
LEVEL_CRITICAL: HealthLevel = "CRITICAL"

# Latency thresholds are operational defaults inspired by Datadog/Grafana SLO buckets.
_LATENCY_P95_DEGRADE_MS = 2000.0
_LATENCY_P95_BAD_MS = 5000.0


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


def _ratio(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return round(numerator / denominator, 6)


def _score_to_level(score: int) -> HealthLevel:
    if score >= 90:
        return LEVEL_HEALTHY
    if score >= 70:
        return LEVEL_DEGRADED
    if score >= 40:
        return LEVEL_UNHEALTHY
    return LEVEL_CRITICAL


def _failure_rate_factor(rate: float) -> HealthFactor | None:
    if rate >= 0.5:
        return HealthFactor(
            code="failure_rate",
            label="Failure rate >= 50%",
            delta=-60,
            detail=f"failure_rate={rate:.2%} (50% threshold)",
        )
    if rate >= 0.25:
        return HealthFactor(
            code="failure_rate",
            label="Failure rate >= 25%",
            delta=-35,
            detail=f"failure_rate={rate:.2%} (25% threshold)",
        )
    if rate >= 0.1:
        return HealthFactor(
            code="failure_rate",
            label="Failure rate >= 10%",
            delta=-20,
            detail=f"failure_rate={rate:.2%} (10% threshold)",
        )
    if rate >= 0.02:
        return HealthFactor(
            code="failure_rate",
            label="Failure rate >= 2%",
            delta=-8,
            detail=f"failure_rate={rate:.2%} (2% threshold)",
        )
    return None


def _retry_rate_factor(rate: float, retry_event_count: int) -> HealthFactor | None:
    if retry_event_count <= 0:
        return None
    if rate >= 0.5:
        return HealthFactor(
            code="retry_rate",
            label="Retry rate >= 50%",
            delta=-25,
            detail=f"retry_rate={rate:.2%}, retry_events={retry_event_count}",
        )
    if rate >= 0.25:
        return HealthFactor(
            code="retry_rate",
            label="Retry rate >= 25%",
            delta=-15,
            detail=f"retry_rate={rate:.2%}, retry_events={retry_event_count}",
        )
    if rate >= 0.1:
        return HealthFactor(
            code="retry_rate",
            label="Retry rate >= 10%",
            delta=-5,
            detail=f"retry_rate={rate:.2%}, retry_events={retry_event_count}",
        )
    return None


def _inactivity_factor(agg: _Aggregate) -> HealthFactor | None:
    if agg.failure_count > 0 and agg.success_count == 0:
        return HealthFactor(
            code="inactivity",
            label="No successful deliveries in window",
            delta=-25,
            detail=f"failures={agg.failure_count} success=0",
        )
    return None


def _repeated_failures_factor(failure_count: int) -> HealthFactor | None:
    if failure_count >= 50:
        return HealthFactor(
            code="repeated_failures",
            label="Sustained failure volume",
            delta=-15,
            detail=f"failure_count={failure_count} (>=50)",
        )
    if failure_count >= 20:
        return HealthFactor(
            code="repeated_failures",
            label="Elevated failure volume",
            delta=-10,
            detail=f"failure_count={failure_count} (>=20)",
        )
    if failure_count >= 10:
        return HealthFactor(
            code="repeated_failures",
            label="Increased failure volume",
            delta=-5,
            detail=f"failure_count={failure_count} (>=10)",
        )
    return None


def _rate_limit_factor(rate_limit_count: int) -> HealthFactor | None:
    if rate_limit_count >= 25:
        return HealthFactor(
            code="rate_limit_pressure",
            label="High rate-limit pressure",
            delta=-10,
            detail=f"rate_limited_events={rate_limit_count} (>=25)",
        )
    if rate_limit_count >= 5:
        return HealthFactor(
            code="rate_limit_pressure",
            label="Rate-limit pressure",
            delta=-5,
            detail=f"rate_limited_events={rate_limit_count} (>=5)",
        )
    return None


def _latency_factor(latency_ms_p95: float | None) -> HealthFactor | None:
    if latency_ms_p95 is None:
        return None
    if latency_ms_p95 >= _LATENCY_P95_BAD_MS:
        return HealthFactor(
            code="latency_p95",
            label="High p95 latency",
            delta=-10,
            detail=f"latency_ms_p95={int(latency_ms_p95)} (>={int(_LATENCY_P95_BAD_MS)} ms)",
        )
    if latency_ms_p95 >= _LATENCY_P95_DEGRADE_MS:
        return HealthFactor(
            code="latency_p95",
            label="Elevated p95 latency",
            delta=-5,
            detail=f"latency_ms_p95={int(latency_ms_p95)} (>={int(_LATENCY_P95_DEGRADE_MS)} ms)",
        )
    return None


def _build_factors(
    agg: _Aggregate,
    *,
    include_latency: bool,
) -> tuple[list[HealthFactor], float, float]:
    """Apply deterministic factors and return (factors, failure_rate, retry_rate)."""

    total_outcomes = agg.failure_count + agg.success_count
    failure_rate = _ratio(agg.failure_count, total_outcomes)
    retry_rate = _ratio(agg.retry_event_count, total_outcomes) if total_outcomes else 0.0

    candidates: list[HealthFactor | None] = [
        _failure_rate_factor(failure_rate),
        _retry_rate_factor(retry_rate, agg.retry_event_count),
        _inactivity_factor(agg),
        _repeated_failures_factor(agg.failure_count),
        _rate_limit_factor(agg.rate_limit_count),
    ]
    if include_latency:
        candidates.append(_latency_factor(agg.latency_ms_p95))
    return [f for f in candidates if f is not None], failure_rate, retry_rate


def compute_health_score(agg: _Aggregate, *, include_latency: bool) -> HealthScore:
    """Public scoring entrypoint shared by all entities (deterministic)."""

    factors, failure_rate, retry_rate = _build_factors(agg, include_latency=include_latency)
    raw = 100 + sum(int(f.delta) for f in factors)
    score = max(0, min(100, raw))
    return HealthScore(
        score=score,
        level=_score_to_level(score),
        factors=factors,
        metrics=HealthMetrics(
            failure_count=agg.failure_count,
            success_count=agg.success_count,
            retry_event_count=agg.retry_event_count,
            retry_count_sum=agg.retry_count_sum,
            failure_rate=failure_rate,
            retry_rate=retry_rate,
            latency_ms_avg=agg.latency_ms_avg,
            latency_ms_p95=agg.latency_ms_p95,
            last_failure_at=agg.last_failure_at,
            last_success_at=agg.last_success_at,
        ),
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


def _score_for_stream(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int,
    route_id: int | None,
    destination_id: int | None,
) -> HealthScore:
    rows = repo.fetch_stream_health_aggregates(
        db,
        since=since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    agg = _empty_aggregate()
    for row in rows:
        d = repo.normalize_aggregate_row(row)
        if d.get("group_id") == stream_id:
            agg = _aggregate_from_dict(d)
            break
    return compute_health_score(agg, include_latency=False)


def _score_for_route(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    route_id: int,
    stream_id: int | None,
    destination_id: int | None,
) -> tuple[HealthScore, int | None, int | None]:
    rows = repo.fetch_route_health_aggregates(
        db,
        since=since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    agg = _empty_aggregate()
    sid: int | None = None
    did: int | None = None
    for row in rows:
        d = repo.normalize_aggregate_row(row)
        if d.get("group_id") == route_id:
            agg = _aggregate_from_dict(d)
            sid = int(row.stream_id) if row.stream_id is not None else None
            did = int(row.destination_id) if row.destination_id is not None else None
            break
    return compute_health_score(agg, include_latency=True), sid, did


def list_stream_health(
    db: Session,
    *,
    window: str | None,
    since: datetime | None,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
) -> StreamHealthListResponse:
    token, start, until = resolve_analytics_window(window=window, since=since)
    rows = repo.fetch_stream_health_aggregates(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    sids = [int(r.group_id) for r in rows if r.group_id is not None]
    lookup = repo.fetch_stream_lookup(db, sids)
    items: list[StreamHealthRow] = []
    for row in rows:
        if row.group_id is None:
            continue
        sid = int(row.group_id)
        agg = _aggregate_from_dict(repo.normalize_aggregate_row(row))
        score = compute_health_score(agg, include_latency=False)
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
) -> RouteHealthListResponse:
    token, start, until = resolve_analytics_window(window=window, since=since)
    rows = repo.fetch_route_health_aggregates(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    items: list[RouteHealthRow] = []
    for row in rows:
        if row.group_id is None:
            continue
        rid = int(row.group_id)
        agg = _aggregate_from_dict(repo.normalize_aggregate_row(row))
        score = compute_health_score(agg, include_latency=True)
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
) -> DestinationHealthListResponse:
    token, start, until = resolve_analytics_window(window=window, since=since)
    rows = repo.fetch_destination_health_aggregates(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    dids = [int(r.group_id) for r in rows if r.group_id is not None]
    lookup = repo.fetch_destination_lookup(db, dids)
    items: list[DestinationHealthRow] = []
    for row in rows:
        if row.group_id is None:
            continue
        did = int(row.group_id)
        agg = _aggregate_from_dict(repo.normalize_aggregate_row(row))
        score = compute_health_score(agg, include_latency=True)
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
) -> HealthOverviewResponse:
    streams = list_stream_health(
        db,
        window=window,
        since=since,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    routes = list_route_health(
        db,
        window=window,
        since=since,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    destinations = list_destination_health(
        db,
        window=window,
        since=since,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )

    s_scores = [r.score for r in streams.rows]
    r_scores = [r.score for r in routes.rows]
    d_scores = [r.score for r in destinations.rows]

    worst_n = max(1, min(int(worst_limit), 25))

    return HealthOverviewResponse(
        time=streams.time,
        filters=streams.filters,
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
) -> StreamHealthDetailResponse:
    stream = repo.fetch_stream_record(db, stream_id)
    if stream is None:
        raise StreamNotFoundError(stream_id)
    token, start, until = resolve_analytics_window(window=window, since=since)
    score = _score_for_stream(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
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
) -> RouteHealthDetailResponse:
    route = repo.fetch_route_record(db, route_id)
    if route is None:
        raise RouteNotFoundError(route_id)
    token, start, until = resolve_analytics_window(window=window, since=since)
    score, sid_from_logs, did_from_logs = _score_for_route(
        db,
        since=start,
        until=until,
        route_id=route_id,
        stream_id=stream_id,
        destination_id=destination_id,
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
    "compute_health_score",
    "get_health_overview",
    "get_route_health_detail",
    "get_stream_health_detail",
    "list_destination_health",
    "list_route_health",
    "list_stream_health",
]
