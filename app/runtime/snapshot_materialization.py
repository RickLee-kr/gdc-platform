"""Race-safe runtime aggregate snapshot materialization."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import TypeVar

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import settings
from app.runtime.models import RuntimeAggregateSnapshot

T = TypeVar("T", bound=BaseModel)

DEFAULT_SNAPSHOT_TTL_SECONDS = 20
EXPIRED_SNAPSHOT_CLEANUP_LIMIT = 500


def _configured_snapshot_ttl_seconds() -> int:
    return max(1, int(settings.GDC_RUNTIME_AGGREGATE_SNAPSHOT_TTL_SECONDS))


def _snapshot_cleanup_enabled() -> bool:
    return bool(getattr(settings, "GDC_RUNTIME_AGGREGATE_SNAPSHOT_CLEANUP_ENABLED", False))


def _utc(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _response_dt(response: BaseModel, attr: str) -> datetime:
    raw = getattr(response, attr, None)
    if raw is None:
        time_block = getattr(response, "time", None)
        if time_block is not None:
            if attr == "generated_at":
                raw = getattr(time_block, "generated_at", None)
            elif attr == "window_start":
                raw = getattr(time_block, "since", None)
            elif attr == "window_end":
                raw = getattr(time_block, "until", None)
    if not isinstance(raw, datetime):
        return datetime.now(timezone.utc)
    return _utc(raw)


def _fresh_row(
    db: Session,
    *,
    scope: str,
    key: str,
    snapshot_id: str,
    now: datetime,
) -> RuntimeAggregateSnapshot | None:
    return (
        db.query(RuntimeAggregateSnapshot)
        .filter(
            RuntimeAggregateSnapshot.snapshot_scope == scope,
            RuntimeAggregateSnapshot.snapshot_key == key,
            RuntimeAggregateSnapshot.snapshot_id == snapshot_id,
            RuntimeAggregateSnapshot.expires_at > now,
        )
        .order_by(RuntimeAggregateSnapshot.created_at.desc(), RuntimeAggregateSnapshot.id.desc())
        .first()
    )


def cleanup_expired_snapshots(
    db: Session,
    *,
    now: datetime | None = None,
    limit: int = EXPIRED_SNAPSHOT_CLEANUP_LIMIT,
    dry_run: bool = False,
) -> int:
    """Delete or count a bounded batch of expired materialized snapshots.

    Deletion is disabled by default and requires
    ``GDC_RUNTIME_AGGREGATE_SNAPSHOT_CLEANUP_ENABLED=true``. Dry-run always
    returns the eligible count without mutating rows.
    """

    cutoff = _utc(now)
    lim = max(1, min(int(limit), 5000))
    if dry_run or not _snapshot_cleanup_enabled():
        result = db.execute(
            text(
                """
                SELECT count(*)
                FROM (
                    SELECT id
                    FROM runtime_aggregate_snapshots
                    WHERE expires_at <= :cutoff
                    ORDER BY expires_at ASC
                    LIMIT :lim
                ) expired
                """
            ),
            {"cutoff": cutoff, "lim": lim},
        )
        return int(result.scalar() or 0)
    result = db.execute(
        text(
            """
            DELETE FROM runtime_aggregate_snapshots
            WHERE id IN (
                SELECT id
                FROM runtime_aggregate_snapshots
                WHERE expires_at <= :cutoff
                ORDER BY expires_at ASC
                LIMIT :lim
            )
            """
        ),
        {"cutoff": cutoff, "lim": lim},
    )
    return int(result.rowcount or 0)


def get_or_materialize_snapshot(
    db: Session,
    *,
    scope: str,
    key: str,
    snapshot_id: str,
    model_type: type[T],
    builder: Callable[[], T],
    ttl_seconds: int | None = None,
) -> T:
    """Return a materialized response or build and persist one.

    PostgreSQL advisory transaction locks coalesce concurrent regeneration for the
    same scope/key/snapshot while preserving normal API response contracts.
    """

    now = datetime.now(timezone.utc)
    try:
        existing = _fresh_row(db, scope=scope, key=key, snapshot_id=snapshot_id, now=now)
    except SQLAlchemyError:
        db.rollback()
        return builder()
    if existing is not None:
        return model_type.model_validate(existing.payload_json)

    lock_key = f"{scope}:{key}:{snapshot_id}"
    try:
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"), {"lock_key": lock_key})
        existing = _fresh_row(db, scope=scope, key=key, snapshot_id=snapshot_id, now=datetime.now(timezone.utc))
    except SQLAlchemyError:
        db.rollback()
        return builder()
    if existing is not None:
        return model_type.model_validate(existing.payload_json)

    response = builder()
    ttl = _configured_snapshot_ttl_seconds() if ttl_seconds is None else max(1, int(ttl_seconds))
    payload = response.model_dump(mode="json")
    generated_at = _response_dt(response, "generated_at")
    window_start = _response_dt(response, "window_start")
    window_end = _response_dt(response, "window_end")
    try:
        cleanup_expired_snapshots(db)
        db.add(
            RuntimeAggregateSnapshot(
                snapshot_scope=scope,
                snapshot_key=key,
                snapshot_id=snapshot_id,
                generated_at=generated_at,
                window_start=window_start,
                window_end=window_end,
                payload_json=payload,
                metric_meta_json=payload.get("metric_meta") if isinstance(payload.get("metric_meta"), dict) else {},
                visualization_meta_json=payload.get("visualization_meta")
                if isinstance(payload.get("visualization_meta"), dict)
                else {},
                expires_at=datetime.now(timezone.utc) + timedelta(seconds=ttl),
            )
        )
        db.commit()
    except SQLAlchemyError:
        db.rollback()
    return response

