"""Bounded delivery_logs queries for stream-scoped and platform-scoped stage metrics."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.logs.models import DeliveryLog


def load_latest_stage_row(
    db: Session,
    *,
    stream_id: int,
    stage: str,
) -> DeliveryLog | None:
    """Latest row for one stream and stage: ORDER BY created_at DESC, id DESC LIMIT 1."""

    if db is None or not hasattr(db, "query"):
        return None
    query = db.query(DeliveryLog)
    if query is None:
        return None
    return (
        query
        .filter(
            DeliveryLog.stream_id == int(stream_id),
            DeliveryLog.stage == stage,
        )
        .order_by(DeliveryLog.created_at.desc(), DeliveryLog.id.desc())
        .limit(1)
        .first()
    )


def load_recent_stage_rows(
    db: Session,
    *,
    stream_id: int,
    stage: str,
    limit: int,
) -> list[DeliveryLog]:
    """Bounded recent rows for fallback aggregation when cumulative keys are absent."""

    lim = max(1, min(int(limit), 2000))
    return (
        db.query(DeliveryLog)
        .filter(
            DeliveryLog.stream_id == int(stream_id),
            DeliveryLog.stage == stage,
        )
        .order_by(DeliveryLog.created_at.desc(), DeliveryLog.id.desc())
        .limit(lim)
        .all()
    )


def load_latest_stage_metrics(
    db: Session,
    *,
    stage: str,
) -> list[DeliveryLog]:
    """Platform-wide latest row per stream for a stage (MAX(id) GROUP BY stream_id)."""

    latest_id_subq = (
        select(func.max(DeliveryLog.id).label("max_id"))
        .where(DeliveryLog.stage == stage)
        .group_by(DeliveryLog.stream_id)
        .subquery()
    )
    return (
        db.query(DeliveryLog)
        .join(latest_id_subq, DeliveryLog.id == latest_id_subq.c.max_id)
        .all()
    )
