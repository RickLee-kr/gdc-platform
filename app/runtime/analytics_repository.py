"""Read-only aggregates over delivery_logs for operational analytics (PostgreSQL)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Float, Integer, case, cast, func
from sqlalchemy.orm import Session

from app.logs import incremental_aggregates as incremental
from app.logs.models import DeliveryLog

_FAILURE_STAGES = frozenset(
    {
        "route_send_failed",
        "route_retry_failed",
        "route_unknown_failure_policy",
    }
)
_SUCCESS_STAGES = frozenset(
    {
        "route_send_success",
        "route_retry_success",
    }
)
_OUTCOME_STAGES = _FAILURE_STAGES | _SUCCESS_STAGES
_RETRY_OUTCOME_STAGES = frozenset({"route_retry_success", "route_retry_failed"})
_LATENCY_STAGES = _FAILURE_STAGES | _SUCCESS_STAGES


def _scope_clauses(
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
) -> list[Any]:
    clauses: list[Any] = [
        DeliveryLog.created_at >= since,
        DeliveryLog.created_at <= until,
    ]
    if stream_id is not None:
        clauses.append(DeliveryLog.stream_id == stream_id)
    if route_id is not None:
        clauses.append(DeliveryLog.route_id == route_id)
    if destination_id is not None:
        clauses.append(DeliveryLog.destination_id == destination_id)
    return clauses


def fetch_outcome_totals(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
) -> tuple[int, int]:
    """Sum failure + success outcome events (route delivery stages only)."""

    try:
        success, failure = incremental.delivery_outcome_totals(
            db,
            start_at=since,
            end_at=until,
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
        )
        return failure, success
    except Exception:
        pass

    clauses = _scope_clauses(
        since=since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    event_count_expr = func.greatest(
        1,
        func.coalesce(cast(DeliveryLog.payload_sample.op("->>")("event_count"), Integer), 1),
    )
    fail_expr = case((DeliveryLog.stage.in_(_FAILURE_STAGES), event_count_expr), else_=0)
    ok_expr = case((DeliveryLog.stage.in_(_SUCCESS_STAGES), event_count_expr), else_=0)
    row = (
        db.query(
            func.coalesce(func.sum(fail_expr), 0).label("f"),
            func.coalesce(func.sum(ok_expr), 0).label("s"),
        )
        .filter(*clauses)
        .filter(DeliveryLog.stage.in_(_OUTCOME_STAGES))
        .one()
    )
    return int(row.f or 0), int(row.s or 0)


def fetch_route_outcome_rows(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
) -> list[Any]:
    """Per-route outcome counts and last timestamps."""

    try:
        return incremental.route_outcome_rows(
            db,
            since=since,
            until=until,
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
        )
    except Exception:
        pass

    clauses = _scope_clauses(
        since=since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    event_count_expr = func.greatest(
        1,
        func.coalesce(cast(DeliveryLog.payload_sample.op("->>")("event_count"), Integer), 1),
    )
    fail_expr = case((DeliveryLog.stage.in_(_FAILURE_STAGES), event_count_expr), else_=0)
    ok_expr = case((DeliveryLog.stage.in_(_SUCCESS_STAGES), event_count_expr), else_=0)
    fail_ts = case((DeliveryLog.stage.in_(_FAILURE_STAGES), DeliveryLog.created_at))
    ok_ts = case((DeliveryLog.stage.in_(_SUCCESS_STAGES), DeliveryLog.created_at))
    fc = func.coalesce(func.sum(fail_expr), 0).label("failure_count")
    return (
        db.query(
            DeliveryLog.route_id,
            func.max(DeliveryLog.stream_id).label("stream_id"),
            func.max(DeliveryLog.destination_id).label("destination_id"),
            fc,
            func.coalesce(func.sum(ok_expr), 0).label("success_count"),
            func.max(fail_ts).label("last_failure_at"),
            func.max(ok_ts).label("last_success_at"),
        )
        .filter(*clauses)
        .filter(DeliveryLog.route_id.isnot(None))
        .filter(DeliveryLog.stage.in_(_OUTCOME_STAGES))
        .group_by(DeliveryLog.route_id)
        .order_by(fc.desc())
        .all()
    )


def fetch_dimension_failure_counts(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    dimension: str,
) -> list[Any]:
    """Failure counts grouped by destination_id or stream_id."""

    try:
        return incremental.dimension_failure_counts(
            db,
            since=since,
            until=until,
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
            dimension=dimension,
        )
    except Exception:
        pass

    clauses = _scope_clauses(
        since=since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    col = DeliveryLog.destination_id if dimension == "destination" else DeliveryLog.stream_id
    return (
        db.query(
            col.label("dim_id"),
            func.count(DeliveryLog.id).label("failure_count"),
        )
        .filter(*clauses)
        .filter(DeliveryLog.stage.in_(_FAILURE_STAGES))
        .filter(col.isnot(None))
        .group_by(col)
        .order_by(func.count(DeliveryLog.id).desc())
        .limit(50)
        .all()
    )


def fetch_failure_trend_buckets(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    bucket_seconds: int,
) -> list[Any]:
    """Bucket start (UTC) and failure counts."""

    try:
        return incremental.failure_trend_buckets(
            db,
            since=since,
            until=until,
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
            bucket_seconds=bucket_seconds,
        )
    except Exception:
        pass

    clauses = _scope_clauses(
        since=since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    bs = max(60, int(bucket_seconds))
    epoch = func.extract("epoch", DeliveryLog.created_at).cast(Float)
    bucket_epoch = func.floor(epoch / bs) * bs
    bucket_start = func.to_timestamp(bucket_epoch)
    return (
        db.query(
            bucket_start.label("bucket_start"),
            func.count(DeliveryLog.id).label("failure_count"),
        )
        .filter(*clauses)
        .filter(DeliveryLog.stage.in_(_FAILURE_STAGES))
        .group_by(bucket_start)
        .order_by(bucket_start.asc())
        .all()
    )


def fetch_top_error_codes(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    limit: int,
) -> list[Any]:
    try:
        return incremental.count_by_field(
            db,
            since=since,
            until=until,
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
            field="error_code",
            limit=limit,
        )
    except Exception:
        pass

    clauses = _scope_clauses(
        since=since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    lim = max(1, min(int(limit), 50))
    return (
        db.query(
            DeliveryLog.error_code,
            func.count(DeliveryLog.id).label("row_count"),
        )
        .filter(*clauses)
        .filter(DeliveryLog.stage.in_(_FAILURE_STAGES))
        .group_by(DeliveryLog.error_code)
        .order_by(func.count(DeliveryLog.id).desc())
        .limit(lim)
        .all()
    )


def fetch_top_failed_stages(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    limit: int,
) -> list[Any]:
    try:
        return incremental.count_by_field(
            db,
            since=since,
            until=until,
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
            field="stage",
            limit=limit,
        )
    except Exception:
        pass

    clauses = _scope_clauses(
        since=since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    lim = max(1, min(int(limit), 20))
    return (
        db.query(
            DeliveryLog.stage,
            func.count(DeliveryLog.id).label("row_count"),
        )
        .filter(*clauses)
        .filter(DeliveryLog.stage.in_(_FAILURE_STAGES))
        .group_by(DeliveryLog.stage)
        .order_by(func.count(DeliveryLog.id).desc())
        .limit(lim)
        .all()
    )


def fetch_latency_avg_p95(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
) -> tuple[float | None, float | None]:
    """Average and discrete P95 latency_ms for delivery outcome rows that recorded latency."""

    try:
        return incremental.latency_avg_p95(
            db,
            since=since,
            until=until,
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
        )
    except Exception:
        pass

    clauses = _scope_clauses(
        since=since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    row = (
        db.query(
            func.avg(DeliveryLog.latency_ms).label("avg_lat"),
            func.percentile_disc(0.95)
            .within_group(DeliveryLog.latency_ms)
            .label("p95_lat"),
        )
        .filter(*clauses)
        .filter(DeliveryLog.stage.in_(_LATENCY_STAGES))
        .filter(DeliveryLog.latency_ms.isnot(None))
        .one()
    )
    avg_raw = row.avg_lat
    p95_raw = row.p95_lat
    avg: float | None = float(avg_raw) if avg_raw is not None else None
    p95: float | None = float(p95_raw) if p95_raw is not None else None
    return avg, p95


def fetch_last_event_times(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
) -> tuple[datetime | None, datetime | None]:
    """Latest failure and success timestamps in the window."""

    try:
        return incremental.last_event_times(
            db,
            since=since,
            until=until,
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
        )
    except Exception:
        pass

    clauses = _scope_clauses(
        since=since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    fail_ts = (
        db.query(func.max(DeliveryLog.created_at))
        .filter(*clauses)
        .filter(DeliveryLog.stage.in_(_FAILURE_STAGES))
        .scalar()
    )
    ok_ts = (
        db.query(func.max(DeliveryLog.created_at))
        .filter(*clauses)
        .filter(DeliveryLog.stage.in_(_SUCCESS_STAGES))
        .scalar()
    )
    return fail_ts, ok_ts


def fetch_retry_summary(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
) -> tuple[int, int, int]:
    """retry_success count, retry_failed count, sum(retry_count) for retry outcome stages."""

    try:
        return incremental.retry_summary(
            db,
            since=since,
            until=until,
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
        )
    except Exception:
        pass

    clauses = _scope_clauses(
        since=since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    ok_expr = case((DeliveryLog.stage == "route_retry_success", 1), else_=0)
    bad_expr = case((DeliveryLog.stage == "route_retry_failed", 1), else_=0)
    row = (
        db.query(
            func.coalesce(func.sum(ok_expr), 0).label("ok_n"),
            func.coalesce(func.sum(bad_expr), 0).label("bad_n"),
            func.coalesce(func.sum(DeliveryLog.retry_count), 0).label("retry_sum"),
        )
        .filter(*clauses)
        .filter(DeliveryLog.stage.in_(_RETRY_OUTCOME_STAGES))
        .one()
    )
    return int(row.ok_n or 0), int(row.bad_n or 0), int(row.retry_sum or 0)


def fetch_retry_heavy_streams(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    limit: int,
) -> list[Any]:
    try:
        return incremental.retry_heavy(
            db,
            since=since,
            until=until,
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
            dimension="stream",
            limit=limit,
        )
    except Exception:
        pass

    lim = max(1, min(int(limit), 50))
    clauses = _scope_clauses(
        since=since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    return (
        db.query(
            DeliveryLog.stream_id,
            func.count(DeliveryLog.id).label("evt"),
            func.coalesce(func.sum(DeliveryLog.retry_count), 0).label("rsum"),
        )
        .filter(*clauses)
        .filter(DeliveryLog.stage.in_(_RETRY_OUTCOME_STAGES))
        .filter(DeliveryLog.stream_id.isnot(None))
        .group_by(DeliveryLog.stream_id)
        .order_by(func.count(DeliveryLog.id).desc())
        .limit(lim)
        .all()
    )


def fetch_retry_heavy_routes(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    limit: int,
) -> list[Any]:
    try:
        return incremental.retry_heavy(
            db,
            since=since,
            until=until,
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
            dimension="route",
            limit=limit,
        )
    except Exception:
        pass

    lim = max(1, min(int(limit), 50))
    clauses = _scope_clauses(
        since=since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    return (
        db.query(
            DeliveryLog.route_id,
            func.count(DeliveryLog.id).label("evt"),
            func.coalesce(func.sum(DeliveryLog.retry_count), 0).label("rsum"),
        )
        .filter(*clauses)
        .filter(DeliveryLog.stage.in_(_RETRY_OUTCOME_STAGES))
        .filter(DeliveryLog.route_id.isnot(None))
        .group_by(DeliveryLog.route_id)
        .order_by(func.count(DeliveryLog.id).desc())
        .limit(lim)
        .all()
    )

