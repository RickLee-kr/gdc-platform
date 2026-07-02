"""Bounded historical reads from ``runtime_analytics_bucket_*`` (no delivery_logs GROUP BY)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.runtime.models import RuntimeAnalyticsBucket1m, RuntimeAnalyticsBucket5m
from app.runtime.runtime_analytics_bucket_repository import (
    BucketResolution,
    analytics_buckets_populated,
    bucket_seconds_for_resolution,
    select_resolution_for_window,
)

UTC = timezone.utc


@dataclass(frozen=True)
class PlatformOutcomeBucketRow:
    bucket_start: datetime
    success: int
    failed: int
    rate_limited: int


@dataclass(frozen=True)
class FailureTrendBucketRow:
    bucket_start: datetime
    failure_count: int


@dataclass(frozen=True)
class RouteOutcomeBucketRow:
    route_id: int
    stream_id: int | None
    destination_id: int | None
    failure_count: int
    success_count: int


@dataclass(frozen=True)
class DimensionFailureRow:
    dim_id: int
    failure_count: int


@dataclass(frozen=True)
class RetryHeavyRow:
    group_id: int
    evt: int
    rsum: int


@dataclass(frozen=True)
class DestinationOutcomeRow:
    destination_id: int
    success_events: int
    failure_events: int


def historical_analytics_available(db: Session) -> bool:
    from app.config import settings

    if not bool(getattr(settings, "GDC_RUNTIME_ANALYTICS_BUCKET_READ_ENABLED", True)):
        return False
    return analytics_buckets_populated(db)


def _model_for_resolution(resolution: BucketResolution):
    return RuntimeAnalyticsBucket1m if resolution == "1m" else RuntimeAnalyticsBucket5m


def _scope_filters(
    model: Any,
    *,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
) -> list[Any]:
    clauses: list[Any] = []
    if stream_id is not None:
        clauses.append(model.stream_id == int(stream_id))
    if route_id is not None:
        clauses.append(model.route_id == int(route_id))
    if destination_id is not None:
        clauses.append(model.destination_id == int(destination_id))
    return clauses


def fetch_platform_outcome_buckets(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    window_seconds: int,
) -> list[PlatformOutcomeBucketRow]:
    resolution = select_resolution_for_window(window_seconds)
    model = _model_for_resolution(resolution)
    src_seconds = bucket_seconds_for_resolution(resolution)
    rows = (
        db.query(
            model.bucket_start,
            func.coalesce(func.sum(model.success_count), 0).label("success"),
            func.coalesce(func.sum(model.failure_count), 0).label("failed"),
            func.coalesce(func.sum(model.rate_limited_count), 0).label("rate_limited"),
        )
        .filter(model.bucket_start >= since, model.bucket_start < until)
        .group_by(model.bucket_start)
        .order_by(model.bucket_start.asc())
        .all()
    )
    if src_seconds <= 0:
        return []
    return [
        PlatformOutcomeBucketRow(
            bucket_start=r[0],
            success=int(r[1] or 0),
            failed=int(r[2] or 0),
            rate_limited=int(r[3] or 0),
        )
        for r in rows
    ]


def rebucket_platform_outcomes(
    rows: list[PlatformOutcomeBucketRow],
    *,
    since: datetime,
    until: datetime,
    target_bucket_seconds: int,
    source_bucket_seconds: int,
) -> list[PlatformOutcomeBucketRow]:
    """Merge source buckets into chart bucket size (bounded)."""

    if not rows or target_bucket_seconds <= 0:
        return []
    by_epoch: dict[float, list[int]] = {}
    for row in rows:
        ep = row.bucket_start.astimezone(UTC).timestamp()
        key = math.floor(ep / target_bucket_seconds) * target_bucket_seconds
        slot = by_epoch.setdefault(key, [0, 0, 0])
        slot[0] += row.success
        slot[1] += row.failed
        slot[2] += row.rate_limited
    end_epoch = until.astimezone(UTC).timestamp()
    end_slot = math.floor(end_epoch / target_bucket_seconds) * target_bucket_seconds
    start_epoch = math.floor(since.astimezone(UTC).timestamp() / target_bucket_seconds) * target_bucket_seconds
    span_slots = max(1, int((end_slot - start_epoch) // target_bucket_seconds) + 1)
    if span_slots > 256:
        start_epoch = end_slot - target_bucket_seconds * 255
    out: list[PlatformOutcomeBucketRow] = []
    t = start_epoch
    while t <= end_slot and len(out) < 256:
        counts = by_epoch.get(t, [0, 0, 0])
        out.append(
            PlatformOutcomeBucketRow(
                bucket_start=datetime.fromtimestamp(t, tz=UTC),
                success=counts[0],
                failed=counts[1],
                rate_limited=counts[2],
            )
        )
        t += target_bucket_seconds
    return out


def fetch_failure_trend_from_buckets(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    bucket_seconds: int,
    window_seconds: int,
) -> list[FailureTrendBucketRow]:
    resolution = select_resolution_for_window(window_seconds)
    model = _model_for_resolution(resolution)
    rows = (
        db.query(
            model.bucket_start,
            func.coalesce(func.sum(model.failure_count), 0).label("failure_count"),
        )
        .filter(model.bucket_start >= since, model.bucket_start < until)
        .filter(*_scope_filters(
            model,
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
        ))
        .group_by(model.bucket_start)
        .order_by(model.bucket_start.asc())
        .all()
    )
    src_seconds = bucket_seconds_for_resolution(resolution)
    raw = [
        FailureTrendBucketRow(bucket_start=r[0], failure_count=int(r[1] or 0))
        for r in rows
    ]
    if bucket_seconds == src_seconds:
        return raw
    by_epoch: dict[float, int] = {}
    for row in raw:
        ep = row.bucket_start.astimezone(UTC).timestamp()
        key = math.floor(ep / bucket_seconds) * bucket_seconds
        by_epoch[key] = by_epoch.get(key, 0) + row.failure_count
    end_epoch = until.astimezone(UTC).timestamp()
    end_slot = math.floor(end_epoch / bucket_seconds) * bucket_seconds
    start_epoch = math.floor(since.astimezone(UTC).timestamp() / bucket_seconds) * bucket_seconds
    # Anchor dense fill on window end so recent buckets are not truncated (max 256 points).
    span_slots = max(1, int((end_slot - start_epoch) // bucket_seconds) + 1)
    if span_slots > 256:
        start_epoch = end_slot - bucket_seconds * 255
    out: list[FailureTrendBucketRow] = []
    t = start_epoch
    while t <= end_slot and len(out) < 256:
        out.append(
            FailureTrendBucketRow(
                bucket_start=datetime.fromtimestamp(t, tz=UTC),
                failure_count=by_epoch.get(t, 0),
            )
        )
        t += bucket_seconds
    return out


def fetch_route_outcomes_from_buckets(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    window_seconds: int,
) -> list[RouteOutcomeBucketRow]:
    resolution = select_resolution_for_window(window_seconds)
    model = _model_for_resolution(resolution)
    q = db.query(
        model.route_id,
        func.max(model.stream_id).label("stream_id"),
        func.max(model.destination_id).label("destination_id"),
        func.coalesce(func.sum(model.failure_count), 0).label("failure_count"),
        func.coalesce(func.sum(model.success_count), 0).label("success_count"),
    ).filter(
        model.bucket_start >= since,
        model.bucket_start < until,
        model.route_id.isnot(None),
    )
    if stream_id is not None:
        q = q.filter(model.stream_id == int(stream_id))
    if route_id is not None:
        q = q.filter(model.route_id == int(route_id))
    if destination_id is not None:
        q = q.filter(model.destination_id == int(destination_id))
    rows = q.group_by(model.route_id).order_by(func.sum(model.failure_count).desc()).all()
    return [
        RouteOutcomeBucketRow(
            route_id=int(r[0]),
            stream_id=int(r[1]) if r[1] is not None else None,
            destination_id=int(r[2]) if r[2] is not None else None,
            failure_count=int(r[3] or 0),
            success_count=int(r[4] or 0),
        )
        for r in rows
        if r[0] is not None
    ]


def fetch_dimension_failures_from_buckets(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    dimension: str,
    window_seconds: int,
) -> list[DimensionFailureRow]:
    resolution = select_resolution_for_window(window_seconds)
    model = _model_for_resolution(resolution)
    col = model.destination_id if dimension == "destination" else model.stream_id
    q = db.query(
        col.label("dim_id"),
        func.coalesce(func.sum(model.failure_count), 0).label("failure_count"),
    ).filter(
        model.bucket_start >= since,
        model.bucket_start < until,
        model.route_id.isnot(None),
        col.isnot(None),
    )
    if stream_id is not None:
        q = q.filter(model.stream_id == int(stream_id))
    if route_id is not None:
        q = q.filter(model.route_id == int(route_id))
    if destination_id is not None:
        q = q.filter(model.destination_id == int(destination_id))
    rows = q.group_by(col).order_by(func.sum(model.failure_count).desc()).limit(50).all()
    return [
        DimensionFailureRow(dim_id=int(r[0]), failure_count=int(r[1] or 0))
        for r in rows
        if r[0] is not None
    ]


def fetch_outcome_totals_from_buckets(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    window_seconds: int,
) -> tuple[int, int]:
    resolution = select_resolution_for_window(window_seconds)
    model = _model_for_resolution(resolution)
    row = (
        db.query(
            func.coalesce(func.sum(model.failure_count), 0).label("f"),
            func.coalesce(func.sum(model.success_count), 0).label("s"),
        )
        .filter(model.bucket_start >= since, model.bucket_start < until)
        .filter(*_scope_filters(
            model,
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
        ))
        .one()
    )
    return int(row.f or 0), int(row.s or 0)


def fetch_latency_from_buckets(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    window_seconds: int,
) -> tuple[float | None, float | None]:
    resolution = select_resolution_for_window(window_seconds)
    model = _model_for_resolution(resolution)
    rows = (
        db.query(model.latency_avg_ms, model.latency_p95_ms, model.event_count)
        .filter(model.bucket_start >= since, model.bucket_start < until)
        .filter(model.latency_avg_ms.isnot(None))
        .filter(*_scope_filters(
            model,
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
        ))
        .all()
    )
    if not rows:
        return None, None
    weighted = 0.0
    weight = 0
    p95_vals: list[float] = []
    for avg, p95, events in rows:
        w = max(1, int(events or 0))
        if avg is not None:
            weighted += float(avg) * w
            weight += w
        if p95 is not None:
            p95_vals.append(float(p95))
    avg_out = round(weighted / weight, 4) if weight > 0 else None
    p95_out = max(p95_vals) if p95_vals else None
    return avg_out, p95_out


@dataclass(frozen=True)
class ObservabilityBucketTotals:
    delivery_success_events: int
    delivery_failed_events: int
    processed_events: int
    rate_limited_events: int
    retry_event_rows: int
    runtime_telemetry_rows: int
    p95_latency_ms: float | None


def fetch_observability_totals_from_buckets(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    window_seconds: int,
) -> ObservabilityBucketTotals:
    """Platform observability totals from ``runtime_analytics_bucket_*`` (no delivery_logs scan)."""

    resolution = select_resolution_for_window(window_seconds)
    model = _model_for_resolution(resolution)
    row = (
        db.query(
            func.coalesce(func.sum(model.success_count), 0).label("success"),
            func.coalesce(func.sum(model.failure_count), 0).label("failed"),
            func.coalesce(func.sum(model.event_count), 0).label("processed"),
            func.coalesce(func.sum(model.rate_limited_count), 0).label("rate_limited"),
            func.coalesce(func.sum(model.retry_count), 0).label("retry_rows"),
        )
        .filter(model.bucket_start >= since, model.bucket_start < until)
        .one()
    )
    success = int(row.success or 0)
    failed = int(row.failed or 0)
    processed = int(row.processed or 0)
    rate_limited = int(row.rate_limited or 0)
    retry_rows = int(row.retry_rows or 0)
    telemetry_rows = success + failed + rate_limited + retry_rows
    _avg, p95 = fetch_latency_from_buckets(
        db,
        since=since,
        until=until,
        stream_id=None,
        route_id=None,
        destination_id=None,
        window_seconds=window_seconds,
    )
    return ObservabilityBucketTotals(
        delivery_success_events=success,
        delivery_failed_events=failed,
        processed_events=processed,
        rate_limited_events=rate_limited,
        retry_event_rows=retry_rows,
        runtime_telemetry_rows=telemetry_rows,
        p95_latency_ms=p95,
    )


def fetch_retry_heavy_from_buckets(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    dimension: str,
    limit: int,
    window_seconds: int,
) -> list[RetryHeavyRow]:
    resolution = select_resolution_for_window(window_seconds)
    model = _model_for_resolution(resolution)
    col = model.stream_id if dimension == "stream" else model.route_id
    q = db.query(
        col.label("group_id"),
        func.coalesce(func.sum(model.retry_count), 0).label("evt"),
        func.coalesce(func.sum(model.retry_count), 0).label("rsum"),
    ).filter(
        model.bucket_start >= since,
        model.bucket_start < until,
        model.route_id.isnot(None),
        col.isnot(None),
    )
    if stream_id is not None:
        q = q.filter(model.stream_id == int(stream_id))
    if route_id is not None:
        q = q.filter(model.route_id == int(route_id))
    if destination_id is not None:
        q = q.filter(model.destination_id == int(destination_id))
    rows = (
        q.group_by(col)
        .order_by(func.sum(model.retry_count).desc())
        .limit(max(1, min(int(limit), 50)))
        .all()
    )
    return [
        RetryHeavyRow(group_id=int(r[0]), evt=int(r[1] or 0), rsum=int(r[2] or 0))
        for r in rows
        if r[0] is not None
    ]


def fetch_destination_outcomes_from_buckets(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    window_seconds: int,
) -> list[DestinationOutcomeRow]:
    resolution = select_resolution_for_window(window_seconds)
    model = _model_for_resolution(resolution)
    rows = (
        db.query(
            model.destination_id,
            func.coalesce(func.sum(model.success_count), 0).label("success_events"),
            func.coalesce(func.sum(model.failure_count), 0).label("failure_events"),
        )
        .filter(
            model.bucket_start >= since,
            model.bucket_start < until,
            model.route_id.isnot(None),
            model.destination_id.isnot(None),
        )
        .group_by(model.destination_id)
        .all()
    )
    return [
        DestinationOutcomeRow(
            destination_id=int(r[0]),
            success_events=int(r[1] or 0),
            failure_events=int(r[2] or 0),
        )
        for r in rows
        if r[0] is not None
    ]


@dataclass(frozen=True)
class StreamScopedDeliveryBucketRow:
    bucket_start: datetime
    events: int
    delivered: int
    failed: int
    avg_latency_ms: float


@dataclass(frozen=True)
class RouteWindowBucketStatsRow:
    route_id: int
    success_count: int
    failure_count: int
    retry_count: int
    rate_limited_count: int
    avg_latency_ms: float | None
    max_latency_ms: float | None


@dataclass(frozen=True)
class RouteTrendBucketStatsRow:
    route_id: int
    bucket_start: datetime
    delivered_events: int
    failed_events: int
    avg_latency_ms: float


def fetch_stream_scoped_outcome_buckets(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int,
    window_seconds: int,
) -> list[StreamScopedDeliveryBucketRow]:
    """Per-bucket delivery outcomes for one stream (no delivery_logs scan)."""

    resolution = select_resolution_for_window(window_seconds)
    model = _model_for_resolution(resolution)
    rows = (
        db.query(
            model.bucket_start,
            func.coalesce(func.sum(model.event_count), 0).label("events"),
            func.coalesce(func.sum(model.success_count), 0).label("delivered"),
            func.coalesce(func.sum(model.failure_count), 0).label("failed"),
            func.coalesce(
                func.sum(model.latency_avg_ms * func.greatest(model.event_count, 1)),
                0.0,
            ).label("latency_weighted"),
            func.coalesce(func.sum(func.greatest(model.event_count, 1)), 0).label("latency_weight"),
        )
        .filter(
            model.bucket_start >= since,
            model.bucket_start < until,
            model.stream_id == int(stream_id),
        )
        .group_by(model.bucket_start)
        .order_by(model.bucket_start.asc())
        .all()
    )
    out: list[StreamScopedDeliveryBucketRow] = []
    for row in rows:
        weight = max(1, int(row.latency_weight or 0))
        avg_lat = float(row.latency_weighted or 0.0) / weight if weight > 0 else 0.0
        out.append(
            StreamScopedDeliveryBucketRow(
                bucket_start=row.bucket_start,
                events=int(row.events or 0),
                delivered=int(row.delivered or 0),
                failed=int(row.failed or 0),
                avg_latency_ms=round(avg_lat, 3),
            )
        )
    return out


def fetch_stream_processed_events_from_buckets(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int,
    window_seconds: int,
) -> int:
    resolution = select_resolution_for_window(window_seconds)
    model = _model_for_resolution(resolution)
    total = (
        db.query(func.coalesce(func.sum(model.event_count), 0))
        .filter(
            model.bucket_start >= since,
            model.bucket_start < until,
            model.stream_id == int(stream_id),
        )
        .scalar()
    )
    return int(total or 0)


def fetch_route_window_stats_from_buckets(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int,
    window_seconds: int,
) -> list[RouteWindowBucketStatsRow]:
    resolution = select_resolution_for_window(window_seconds)
    model = _model_for_resolution(resolution)
    rows = (
        db.query(
            model.route_id,
            func.coalesce(func.sum(model.success_count), 0).label("success_count"),
            func.coalesce(func.sum(model.failure_count), 0).label("failure_count"),
            func.coalesce(func.sum(model.retry_count), 0).label("retry_count"),
            func.coalesce(func.sum(model.rate_limited_count), 0).label("rate_limited_count"),
            func.coalesce(
                func.sum(model.latency_avg_ms * func.greatest(model.event_count, 1)),
                0.0,
            ).label("latency_weighted"),
            func.coalesce(func.sum(func.greatest(model.event_count, 1)), 0).label("latency_weight"),
            func.coalesce(func.max(model.latency_max_ms), 0.0).label("max_latency_ms"),
        )
        .filter(
            model.bucket_start >= since,
            model.bucket_start < until,
            model.stream_id == int(stream_id),
            model.route_id.isnot(None),
        )
        .group_by(model.route_id)
        .all()
    )
    out: list[RouteWindowBucketStatsRow] = []
    for row in rows:
        if row.route_id is None:
            continue
        weight = max(1, int(row.latency_weight or 0))
        avg_lat = float(row.latency_weighted or 0.0) / weight if weight > 0 else None
        out.append(
            RouteWindowBucketStatsRow(
                route_id=int(row.route_id),
                success_count=int(row.success_count or 0),
                failure_count=int(row.failure_count or 0),
                retry_count=int(row.retry_count or 0),
                rate_limited_count=int(row.rate_limited_count or 0),
                avg_latency_ms=round(avg_lat, 3) if avg_lat is not None else None,
                max_latency_ms=float(row.max_latency_ms or 0.0) if row.max_latency_ms else None,
            )
        )
    return out


def fetch_route_trend_buckets_from_buckets(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int,
    bucket_seconds: int,
    window_seconds: int,
) -> list[RouteTrendBucketStatsRow]:
    resolution = select_resolution_for_window(window_seconds)
    model = _model_for_resolution(resolution)
    src_seconds = bucket_seconds_for_resolution(resolution)
    rows = (
        db.query(
            model.route_id,
            model.bucket_start,
            func.coalesce(func.sum(model.success_count), 0).label("delivered"),
            func.coalesce(func.sum(model.failure_count), 0).label("failed"),
            func.coalesce(
                func.sum(model.latency_avg_ms * func.greatest(model.event_count, 1)),
                0.0,
            ).label("latency_weighted"),
            func.coalesce(func.sum(func.greatest(model.event_count, 1)), 0).label("latency_weight"),
        )
        .filter(
            model.bucket_start >= since,
            model.bucket_start < until,
            model.stream_id == int(stream_id),
            model.route_id.isnot(None),
        )
        .group_by(model.route_id, model.bucket_start)
        .order_by(model.route_id.asc(), model.bucket_start.asc())
        .all()
    )
    raw: list[RouteTrendBucketStatsRow] = []
    for row in rows:
        if row.route_id is None:
            continue
        weight = max(1, int(row.latency_weight or 0))
        avg_lat = float(row.latency_weighted or 0.0) / weight if weight > 0 else 0.0
        raw.append(
            RouteTrendBucketStatsRow(
                route_id=int(row.route_id),
                bucket_start=row.bucket_start,
                delivered_events=int(row.delivered or 0),
                failed_events=int(row.failed or 0),
                avg_latency_ms=round(avg_lat, 3),
            )
        )
    if bucket_seconds == src_seconds or not raw:
        return raw
    by_key: dict[tuple[int, float], list[float | int]] = {}
    for row in raw:
        ep = row.bucket_start.astimezone(UTC).timestamp()
        key_epoch = math.floor(ep / bucket_seconds) * bucket_seconds
        slot = by_key.setdefault(
            (row.route_id, key_epoch),
            [0, 0, 0.0, 0],
        )
        slot[0] = int(slot[0]) + row.delivered_events
        slot[1] = int(slot[1]) + row.failed_events
        slot[2] = float(slot[2]) + row.avg_latency_ms * max(1, row.delivered_events + row.failed_events)
        slot[3] = int(slot[3]) + max(1, row.delivered_events + row.failed_events)
    merged: list[RouteTrendBucketStatsRow] = []
    for (route_id, key_epoch), slot in sorted(by_key.items()):
        weight = max(1, int(slot[3]))
        merged.append(
            RouteTrendBucketStatsRow(
                route_id=route_id,
                bucket_start=datetime.fromtimestamp(key_epoch, tz=UTC),
                delivered_events=int(slot[0]),
                failed_events=int(slot[1]),
                avg_latency_ms=round(float(slot[2]) / weight, 3),
            )
        )
    return merged
