"""PostgreSQL-friendly batched deletes by ``created_at`` (or similar) ordering."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.sql import ColumnElement

_MAX_BATCH_ITERATIONS = 200


def eligible_count_and_oldest(
    db: Session,
    *,
    model: type,
    time_column: Any,
    cutoff: datetime,
    extra: ColumnElement[bool] | None = None,
) -> tuple[int, datetime | None]:
    """Return ``(count, min(timestamp))`` for rows strictly older than ``cutoff``."""

    flt = time_column < cutoff
    if extra is not None:
        flt = flt & extra
    cnt = int(db.query(model).filter(flt).count())
    if cnt == 0:
        return 0, None
    oldest = db.scalar(select(func.min(time_column)).where(flt))
    return cnt, oldest


def batch_delete_by_time_before(
    db: Session,
    *,
    model: type,
    time_column: Any,
    cutoff: datetime,
    batch_size: int,
    dry_run: bool,
    extra: ColumnElement[bool] | None = None,
    max_deleted: int | None = None,
) -> tuple[int, int]:
    """Delete rows with ``time_column < cutoff`` in batches of at most ``batch_size``.

    Returns ``(matched_count, deleted_count)``. Each delete batch is committed
    separately to avoid long table locks. On any exception the caller should
    ``rollback`` the session — this function does not swallow DB errors.

    When ``max_deleted`` is set, stop after deleting at most that many rows
    (used by lab auto-remediation to bound each run).
    """

    flt = time_column < cutoff
    if extra is not None:
        flt = flt & extra
    matched_count = int(db.query(model).filter(flt).count())
    if dry_run or matched_count == 0:
        return matched_count, 0

    total_deleted = 0
    iterations = 0
    pk = getattr(model, "id")
    limit_cap = int(max_deleted) if max_deleted is not None else None
    while iterations < _MAX_BATCH_ITERATIONS:
        iterations += 1
        remaining = None if limit_cap is None else max(0, limit_cap - total_deleted)
        if remaining is not None and remaining <= 0:
            break
        this_batch = max(1, int(batch_size))
        if remaining is not None:
            this_batch = min(this_batch, remaining)
        ids_subq = (
            select(pk)
            .where(flt)
            .order_by(time_column.asc(), pk.asc())
            .limit(this_batch)
            .scalar_subquery()
        )
        deleted = db.query(model).filter(pk.in_(ids_subq)).delete(synchronize_session=False)
        if deleted is None:
            deleted = 0
        if deleted <= 0:
            break
        total_deleted += int(deleted)
        db.commit()
        if int(deleted) < this_batch:
            break
    return matched_count, total_deleted


__all__ = ["batch_delete_by_time_before", "eligible_count_and_oldest", "_MAX_BATCH_ITERATIONS"]
