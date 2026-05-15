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
) -> tuple[int, int]:
    """Delete rows with ``time_column < cutoff`` in batches of at most ``batch_size``.

    Returns ``(matched_count, deleted_count)``. Each delete batch is committed
    separately to avoid long table locks. On any exception the caller should
    ``rollback`` the session — this function does not swallow DB errors.
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
    while iterations < _MAX_BATCH_ITERATIONS:
        iterations += 1
        ids_subq = (
            select(pk)
            .where(flt)
            .order_by(time_column.asc(), pk.asc())
            .limit(max(1, int(batch_size)))
            .scalar_subquery()
        )
        deleted = db.query(model).filter(pk.in_(ids_subq)).delete(synchronize_session=False)
        if deleted is None:
            deleted = 0
        if deleted <= 0:
            break
        total_deleted += int(deleted)
        db.commit()
        if int(deleted) < int(batch_size):
            break
    return matched_count, total_deleted


__all__ = ["batch_delete_by_time_before", "eligible_count_and_oldest", "_MAX_BATCH_ITERATIONS"]
