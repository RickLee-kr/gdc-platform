"""Read-only analytics orchestration for delivery_logs aggregates."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.routes.models import Route
from app.runtime import analytics_repository as repo
from app.runtime.analytics_schemas import (
    AnalyticsScopeFilters,
    AnalyticsTimeWindow,
    CodeCount,
    DimensionCount,
    FailureTotals,
    FailureTrendBucket,
    RetrySummaryResponse,
    RouteFailuresAnalyticsResponse,
    RouteFailuresScopedResponse,
    RouteOutcomeRow,
    RouteRetryRow,
    StageCount,
    StreamRetriesAnalyticsResponse,
    StreamRetryRow,
    UnstableRouteCandidate,
)
from app.runtime.metrics_window import (
    bucket_seconds_for_window,
    normalize_metrics_window_token,
    parse_metrics_window,
)
from app.runtime.read_service import RouteNotFoundError

UTC = timezone.utc


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def resolve_analytics_window(
    *,
    window: str | None,
    since: datetime | None,
) -> tuple[str, datetime, datetime]:
    """Return window label, inclusive since, inclusive until (UTC now).

    When ``since`` is provided it overrides the rolling window; the label becomes ``custom``.
    """

    until = datetime.now(UTC)
    if since is not None:
        start = _ensure_utc(since)
        return "custom", start, until
    token = normalize_metrics_window_token(window or "24h")
    td = parse_metrics_window(token)
    start = until - td
    return token, start, until


def _failure_rate(failures: int, successes: int) -> float:
    denom = failures + successes
    if denom <= 0:
        return 0.0
    return round(failures / denom, 6)


def _pick_unstable(
    rows: list[RouteOutcomeRow],
    *,
    min_samples: int = 5,
    min_rate: float = 0.15,
    limit: int = 25,
) -> list[UnstableRouteCandidate]:
    candidates: list[UnstableRouteCandidate] = []
    for r in rows:
        n = r.failure_count + r.success_count
        if n < min_samples:
            continue
        if r.failure_rate >= min_rate:
            candidates.append(
                UnstableRouteCandidate(
                    route_id=r.route_id,
                    stream_id=r.stream_id,
                    destination_id=r.destination_id,
                    failure_count=r.failure_count,
                    success_count=r.success_count,
                    failure_rate=r.failure_rate,
                    sample_total=n,
                )
            )
    candidates.sort(key=lambda x: (-x.failure_rate, -x.failure_count, x.route_id))
    return candidates[:limit]


def get_route_failures_analytics(
    db: Session,
    *,
    window: str | None,
    since: datetime | None,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
) -> RouteFailuresAnalyticsResponse:
    token, start, until = resolve_analytics_window(window=window, since=since)
    filters = AnalyticsScopeFilters(
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    bs = bucket_seconds_for_window(max(timedelta(seconds=60), until - start))

    tot_f, tot_s = repo.fetch_outcome_totals(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    totals = FailureTotals(
        failure_events=tot_f,
        success_events=tot_s,
        overall_failure_rate=_failure_rate(tot_f, tot_s),
    )

    route_rows_raw = repo.fetch_route_outcome_rows(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    outcomes: list[RouteOutcomeRow] = []
    for row in route_rows_raw:
        rid = int(row.route_id)
        fc = int(row.failure_count or 0)
        sc = int(row.success_count or 0)
        outcomes.append(
            RouteOutcomeRow(
                route_id=rid,
                stream_id=int(row.stream_id) if row.stream_id is not None else None,
                destination_id=int(row.destination_id) if row.destination_id is not None else None,
                failure_count=fc,
                success_count=sc,
                failure_rate=_failure_rate(fc, sc),
                last_failure_at=row.last_failure_at,
                last_success_at=row.last_success_at,
            )
        )

    dest_rows = repo.fetch_dimension_failure_counts(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        dimension="destination",
    )
    stream_rows = repo.fetch_dimension_failure_counts(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        dimension="stream",
    )

    trend_raw = repo.fetch_failure_trend_buckets(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        bucket_seconds=bs,
    )
    trend = [
        FailureTrendBucket(bucket_start=tr.bucket_start, failure_count=int(tr.failure_count or 0))
        for tr in trend_raw
    ]

    codes_raw = repo.fetch_top_error_codes(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        limit=15,
    )
    top_codes = [
        CodeCount(error_code=r.error_code, count=int(r.row_count or 0)) for r in codes_raw
    ]

    stages_raw = repo.fetch_top_failed_stages(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        limit=10,
    )
    top_stages = [StageCount(stage=r.stage, count=int(r.row_count or 0)) for r in stages_raw]

    avg_lat, p95_lat = repo.fetch_latency_avg_p95(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    last_fail, last_ok = repo.fetch_last_event_times(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )

    return RouteFailuresAnalyticsResponse(
        time=AnalyticsTimeWindow(window=token, since=start, until=until),
        filters=filters,
        totals=totals,
        latency_ms_avg=avg_lat,
        latency_ms_p95=p95_lat,
        last_failure_at=last_fail,
        last_success_at=last_ok,
        outcomes_by_route=outcomes,
        failures_by_destination=[
            DimensionCount(id=int(r.dim_id), failure_count=int(r.failure_count or 0))
            for r in dest_rows
            if r.dim_id is not None
        ],
        failures_by_stream=[
            DimensionCount(id=int(r.dim_id), failure_count=int(r.failure_count or 0))
            for r in stream_rows
            if r.dim_id is not None
        ],
        failure_trend=trend,
        top_error_codes=top_codes,
        top_failed_stages=top_stages,
        unstable_routes=_pick_unstable(outcomes),
    )


def get_route_failures_for_route(
    db: Session,
    *,
    route_id: int,
    window: str | None,
    since: datetime | None,
    stream_id: int | None,
    destination_id: int | None,
) -> RouteFailuresScopedResponse:
    route = db.query(Route).filter(Route.id == route_id).first()
    if route is None:
        raise RouteNotFoundError(route_id)

    token, start, until = resolve_analytics_window(window=window, since=since)
    filters = AnalyticsScopeFilters(
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    span = max(timedelta(seconds=60), until - start)
    bs = bucket_seconds_for_window(span)

    tot_f, tot_s = repo.fetch_outcome_totals(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    totals = FailureTotals(
        failure_events=tot_f,
        success_events=tot_s,
        overall_failure_rate=_failure_rate(tot_f, tot_s),
    )

    dest_rows = repo.fetch_dimension_failure_counts(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        dimension="destination",
    )
    trend_raw = repo.fetch_failure_trend_buckets(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        bucket_seconds=bs,
    )
    trend = [
        FailureTrendBucket(bucket_start=tr.bucket_start, failure_count=int(tr.failure_count or 0))
        for tr in trend_raw
    ]
    codes_raw = repo.fetch_top_error_codes(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        limit=15,
    )
    top_codes = [
        CodeCount(error_code=r.error_code, count=int(r.row_count or 0)) for r in codes_raw
    ]
    stages_raw = repo.fetch_top_failed_stages(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        limit=10,
    )
    top_stages = [StageCount(stage=r.stage, count=int(r.row_count or 0)) for r in stages_raw]

    avg_lat, p95_lat = repo.fetch_latency_avg_p95(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    last_fail, last_ok = repo.fetch_last_event_times(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )

    return RouteFailuresScopedResponse(
        route_id=route_id,
        time=AnalyticsTimeWindow(window=token, since=start, until=until),
        filters=filters,
        totals=totals,
        latency_ms_avg=avg_lat,
        latency_ms_p95=p95_lat,
        last_failure_at=last_fail,
        last_success_at=last_ok,
        failures_by_destination=[
            DimensionCount(id=int(r.dim_id), failure_count=int(r.failure_count or 0))
            for r in dest_rows
            if r.dim_id is not None
        ],
        failure_trend=trend,
        top_error_codes=top_codes,
        top_failed_stages=top_stages,
    )


def get_stream_retries_analytics(
    db: Session,
    *,
    window: str | None,
    since: datetime | None,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    limit: int,
) -> StreamRetriesAnalyticsResponse:
    token, start, until = resolve_analytics_window(window=window, since=since)
    filters = AnalyticsScopeFilters(
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    lim = max(1, min(int(limit), 50))

    srows = repo.fetch_retry_heavy_streams(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        limit=lim,
    )
    rrows = repo.fetch_retry_heavy_routes(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        limit=lim,
    )

    return StreamRetriesAnalyticsResponse(
        time=AnalyticsTimeWindow(window=token, since=start, until=until),
        filters=filters,
        retry_heavy_streams=[
            StreamRetryRow(
                stream_id=int(x.stream_id),
                retry_event_count=int(x.evt or 0),
                retry_column_sum=int(x.rsum or 0),
            )
            for x in srows
        ],
        retry_heavy_routes=[
            RouteRetryRow(
                route_id=int(x.route_id),
                retry_event_count=int(x.evt or 0),
                retry_column_sum=int(x.rsum or 0),
            )
            for x in rrows
        ],
    )


def get_retry_summary(
    db: Session,
    *,
    window: str | None,
    since: datetime | None,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
) -> RetrySummaryResponse:
    token, start, until = resolve_analytics_window(window=window, since=since)
    filters = AnalyticsScopeFilters(
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    ok_n, bad_n, rsum = repo.fetch_retry_summary(
        db,
        since=start,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    return RetrySummaryResponse(
        time=AnalyticsTimeWindow(window=token, since=start, until=until),
        filters=filters,
        retry_success_events=ok_n,
        retry_failed_events=bad_n,
        total_retry_outcome_events=ok_n + bad_n,
        retry_column_sum=rsum,
    )

