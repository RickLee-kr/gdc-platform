"""PostgreSQL partition management for delivery_logs."""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def month_floor(value: date | datetime) -> date:
    """Return the first day of the UTC month for a date/datetime."""

    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc)
        value = value.date()
    return date(value.year, value.month, 1)


def add_month(value: date) -> date:
    """Return the first day of the following month."""

    if value.month == 12:
        return date(value.year + 1, 1, 1)
    return date(value.year, value.month + 1, 1)


def partition_name(month_start: date) -> str:
    """Return the canonical monthly partition name."""

    return f"delivery_logs_{month_start.year:04d}_{month_start.month:02d}"


def ensure_delivery_log_partition(db: Session, month_start: date) -> str:
    """Create one monthly partition if it is missing and return its name."""

    start = month_floor(month_start)
    end = add_month(start)
    name = partition_name(start)
    db.execute(
        text(
            f"""
            CREATE TABLE IF NOT EXISTS {name}
            PARTITION OF delivery_logs
            FOR VALUES FROM ('{start.isoformat()} 00:00:00+00')
            TO ('{end.isoformat()} 00:00:00+00')
            """
        )
    )
    return name


def ensure_delivery_log_default_partition(db: Session) -> str:
    """Create the default safety partition used when a monthly partition is missing."""

    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS delivery_logs_default
            PARTITION OF delivery_logs DEFAULT
            """
        )
    )
    return "delivery_logs_default"


def ensure_delivery_log_partitions(
    db: Session,
    *,
    start_month: date | datetime | None = None,
    months_ahead: int = 1,
) -> list[str]:
    """Ensure current and future monthly partitions exist.

    The function is additive only. It never detaches, truncates, or drops existing partitions.
    """

    current = month_floor(start_month or datetime.now(timezone.utc))
    count = max(0, int(months_ahead)) + 1
    out: list[str] = []
    month = current
    for _ in range(count):
        out.append(ensure_delivery_log_partition(db, month))
        month = add_month(month)
    out.append(ensure_delivery_log_default_partition(db))
    return out


def ensure_delivery_log_partitions_gracefully(months_ahead: int = 1) -> list[str]:
    """Startup-safe partition ensure using its own transaction.

    Failures are logged and swallowed so API startup is not blocked by a permissions
    or schema-readiness problem. Runtime inserts still depend on the migration-created
    partitioned table and future partition creation.
    """

    from app.database import SessionLocal

    db = SessionLocal()
    try:
        names = ensure_delivery_log_partitions(db, months_ahead=months_ahead)
        db.commit()
        logger.info("%s", {"stage": "delivery_log_partitions_ensured", "partitions": names})
        return names
    except SQLAlchemyError as exc:
        db.rollback()
        logger.warning(
            "%s",
            {
                "stage": "delivery_log_partitions_ensure_failed",
                "error_type": type(exc).__name__,
                "message": str(exc)[:500],
            },
        )
        return []
    finally:
        db.close()

