"""Read-only aggregates over delivery_logs for runtime health scoring (PostgreSQL).

These queries reuse the existing delivery_logs indexes (`stream_id`, `route_id`,
`destination_id`, `stage`, `created_at`) and add per-dimension grouping for
deterministic health scoring. No DB writes occur here.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.destinations.models import Destination
from app.logs.models import DeliveryLog
from app.routes.models import Route
from app.streams.models import Stream

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
_RATE_LIMIT_STAGES = frozenset({"source_rate_limited", "destination_rate_limited"})


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


def _outcome_aggregates(group_col: Any) -> list[Any]:
    """Common per-group outcome aggregates used by stream/route/destination queries."""

    fail_expr = case((DeliveryLog.stage.in_(_FAILURE_STAGES), 1), else_=0)
    ok_expr = case((DeliveryLog.stage.in_(_SUCCESS_STAGES), 1), else_=0)
    retry_evt_expr = case((DeliveryLog.stage.in_(_RETRY_OUTCOME_STAGES), 1), else_=0)
    rl_expr = case((DeliveryLog.stage.in_(_RATE_LIMIT_STAGES), 1), else_=0)
    fail_ts = case((DeliveryLog.stage.in_(_FAILURE_STAGES), DeliveryLog.created_at))
    ok_ts = case((DeliveryLog.stage.in_(_SUCCESS_STAGES), DeliveryLog.created_at))
    latency_expr = case(
        (
            DeliveryLog.stage.in_(_OUTCOME_STAGES),
            DeliveryLog.latency_ms,
        )
    )
    return [
        group_col.label("group_id"),
        func.coalesce(func.sum(fail_expr), 0).label("failure_count"),
        func.coalesce(func.sum(ok_expr), 0).label("success_count"),
        func.coalesce(func.sum(retry_evt_expr), 0).label("retry_event_count"),
        func.coalesce(func.sum(DeliveryLog.retry_count), 0).label("retry_count_sum"),
        func.coalesce(func.sum(rl_expr), 0).label("rate_limit_count"),
        func.max(fail_ts).label("last_failure_at"),
        func.max(ok_ts).label("last_success_at"),
        func.avg(latency_expr).label("latency_ms_avg"),
        func.percentile_disc(0.95).within_group(latency_expr).label("latency_ms_p95"),
    ]


def fetch_stream_health_aggregates(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
) -> list[Any]:
    """Per-stream aggregates suitable for health scoring."""

    clauses = _scope_clauses(
        since=since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    return (
        db.query(*_outcome_aggregates(DeliveryLog.stream_id))
        .filter(*clauses)
        .filter(DeliveryLog.stream_id.isnot(None))
        .group_by(DeliveryLog.stream_id)
        .all()
    )


def fetch_route_health_aggregates(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
) -> list[Any]:
    """Per-route aggregates with stream/destination linkage suitable for health scoring."""

    clauses = _scope_clauses(
        since=since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    base_aggs = _outcome_aggregates(DeliveryLog.route_id)
    return (
        db.query(
            *base_aggs,
            DeliveryLog.stream_id.label("stream_id"),
            DeliveryLog.destination_id.label("destination_id"),
        )
        .filter(*clauses)
        .filter(DeliveryLog.route_id.isnot(None))
        .group_by(DeliveryLog.route_id, DeliveryLog.stream_id, DeliveryLog.destination_id)
        .all()
    )


def fetch_destination_health_aggregates(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
) -> list[Any]:
    """Per-destination aggregates suitable for health scoring."""

    clauses = _scope_clauses(
        since=since,
        until=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    return (
        db.query(*_outcome_aggregates(DeliveryLog.destination_id))
        .filter(*clauses)
        .filter(DeliveryLog.destination_id.isnot(None))
        .group_by(DeliveryLog.destination_id)
        .all()
    )


def fetch_stream_lookup(
    db: Session, stream_ids: list[int]
) -> dict[int, tuple[str | None, int | None]]:
    """Resolve stream_id -> (name, connector_id) for label rendering."""

    if not stream_ids:
        return {}
    rows = (
        db.query(Stream.id, Stream.name, Stream.connector_id)
        .filter(Stream.id.in_(stream_ids))
        .all()
    )
    return {int(r[0]): (r[1], int(r[2]) if r[2] is not None else None) for r in rows}


def fetch_destination_lookup(
    db: Session, destination_ids: list[int]
) -> dict[int, tuple[str | None, str | None]]:
    """Resolve destination_id -> (name, destination_type) for label rendering."""

    if not destination_ids:
        return {}
    rows = (
        db.query(Destination.id, Destination.name, Destination.destination_type)
        .filter(Destination.id.in_(destination_ids))
        .all()
    )
    return {int(r[0]): (r[1], r[2]) for r in rows}


def fetch_route_record(db: Session, route_id: int) -> Route | None:
    """Single route lookup used by the scoped detail endpoint."""

    return db.query(Route).filter(Route.id == route_id).first()


def fetch_stream_record(db: Session, stream_id: int) -> Stream | None:
    """Single stream lookup used by the scoped detail endpoint."""

    return db.query(Stream).filter(Stream.id == stream_id).first()


def latency_value(value: Any) -> float | None:
    """Coerce SQL aggregate latency to float when not null (helper)."""

    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_float_or_none(raw: Any) -> float | None:
    """Defensive cast (some drivers return Decimal for AVG)."""

    return latency_value(raw)


def normalize_aggregate_row(row: Any) -> dict[str, Any]:
    """Convert a SQLAlchemy result row into a dict used by the scoring service."""

    return {
        "group_id": int(row.group_id) if row.group_id is not None else None,
        "failure_count": int(row.failure_count or 0),
        "success_count": int(row.success_count or 0),
        "retry_event_count": int(row.retry_event_count or 0),
        "retry_count_sum": int(row.retry_count_sum or 0),
        "rate_limit_count": int(row.rate_limit_count or 0),
        "last_failure_at": row.last_failure_at,
        "last_success_at": row.last_success_at,
        "latency_ms_avg": _coerce_float_or_none(row.latency_ms_avg),
        "latency_ms_p95": _coerce_float_or_none(row.latency_ms_p95),
    }


__all__ = [
    "fetch_stream_health_aggregates",
    "fetch_route_health_aggregates",
    "fetch_destination_health_aggregates",
    "fetch_stream_lookup",
    "fetch_destination_lookup",
    "fetch_route_record",
    "fetch_stream_record",
    "normalize_aggregate_row",
]
