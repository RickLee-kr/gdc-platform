"""PostgreSQL partition maintenance for runtime operational tables."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.delivery_log_partitions import (
    ensure_delivery_log_partitions,
    list_delivery_log_monthly_partitions,
    protected_partition_months,
)
from app.db.partition_archive import detect_orphan_delivery_log_partitions

logger = logging.getLogger(__name__)
UTC = timezone.utc


@dataclass
class PartitionStatusRow:
    table_name: str
    partition_name: str
    month_start: date | None
    row_count: int | None = None
    is_protected: bool = False
    is_default: bool = False


@dataclass
class PartitionMaintenanceResult:
    ensured_partitions: list[str] = field(default_factory=list)
    orphan_partitions: list[str] = field(default_factory=list)
    failures: list[dict[str, str]] = field(default_factory=list)
    status: str = "ok"
    message: str = ""


@dataclass
class PartitionObservabilitySnapshot:
    generated_at_utc: datetime
    delivery_logs_partitioned: bool
    partition_key: str | None
    partitions: list[PartitionStatusRow]
    protected_months: list[str]
    oldest_partition: str | None
    newest_partition: str | None
    orphan_partitions: list[str]
    retention_days: int
    checkpoint_history_retention_days: int
    last_maintenance: dict[str, Any] = field(default_factory=dict)


def delivery_logs_is_partitioned(db: Session) -> bool:
    return bool(
        db.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM pg_partitioned_table pt
                    JOIN pg_class c ON c.oid = pt.partrelid
                    WHERE c.relname = 'delivery_logs'
                )
                """
            )
        ).scalar()
    )


def delivery_logs_partition_key(db: Session) -> str | None:
    return db.execute(
        text(
            """
            SELECT pg_get_partkeydef(c.oid)
            FROM pg_class c
            JOIN pg_partitioned_table pt ON pt.partrelid = c.oid
            WHERE c.relname = 'delivery_logs'
            """
        )
    ).scalar()


def collect_delivery_log_partition_status(db: Session, *, now: datetime | None = None) -> list[PartitionStatusRow]:
    ref = now or datetime.now(UTC)
    protected = protected_partition_months(ref)
    out: list[PartitionStatusRow] = []
    for name, month_start in list_delivery_log_monthly_partitions(db):
        count = int(db.execute(text(f'SELECT count(*) FROM "{name}"')).scalar() or 0)
        out.append(
            PartitionStatusRow(
                table_name="delivery_logs",
                partition_name=name,
                month_start=month_start,
                row_count=count,
                is_protected=month_start in protected,
                is_default=False,
            )
        )
    try:
        default_count = db.execute(text('SELECT count(*) FROM "delivery_logs_default"')).scalar()
        out.append(
            PartitionStatusRow(
                table_name="delivery_logs",
                partition_name="delivery_logs_default",
                month_start=None,
                row_count=int(default_count or 0),
                is_protected=True,
                is_default=True,
            )
        )
    except SQLAlchemyError:
        pass
    return sorted(out, key=lambda r: (r.month_start or date.min, r.partition_name))


def build_partition_observability(
    db: Session,
    *,
    retention_days: int,
    checkpoint_history_retention_days: int,
    last_maintenance: dict[str, Any] | None = None,
) -> PartitionObservabilitySnapshot:
    rows = collect_delivery_log_partition_status(db)
    monthly = [r for r in rows if r.month_start is not None and not r.is_default]
    monthly_names = [r.partition_name for r in monthly]
    return PartitionObservabilitySnapshot(
        generated_at_utc=datetime.now(UTC),
        delivery_logs_partitioned=delivery_logs_is_partitioned(db),
        partition_key=delivery_logs_partition_key(db),
        partitions=rows,
        protected_months=[m.isoformat() for m in sorted(protected_partition_months())],
        oldest_partition=min(monthly_names) if monthly_names else None,
        newest_partition=max(monthly_names) if monthly_names else None,
        orphan_partitions=detect_orphan_delivery_log_partitions(db),
        retention_days=retention_days,
        checkpoint_history_retention_days=checkpoint_history_retention_days,
        last_maintenance=dict(last_maintenance or {}),
    )


def run_partition_maintenance(
    db: Session,
    *,
    months_ahead: int = 2,
    now: datetime | None = None,
) -> PartitionMaintenanceResult:
    """Idempotent ensure of current/future partitions and orphan detection."""

    result = PartitionMaintenanceResult()
    try:
        if not delivery_logs_is_partitioned(db):
            result.status = "skipped"
            result.message = "delivery_logs is not partitioned; migration 20260517_0021 may be pending"
            return result
        result.ensured_partitions = ensure_delivery_log_partitions(
            db,
            start_month=now,
            months_ahead=months_ahead,
        )
        db.commit()
        result.orphan_partitions = detect_orphan_delivery_log_partitions(db)
        if result.orphan_partitions:
            result.status = "warn"
            result.message = "orphan partitions detected"
        else:
            result.message = "partitions ensured"
    except SQLAlchemyError as exc:
        db.rollback()
        result.status = "error"
        result.message = str(exc)[:500]
        result.failures.append({"error_type": type(exc).__name__, "message": result.message})
        logger.warning(
            "%s",
            {
                "stage": "partition_maintenance_failed",
                "error_type": type(exc).__name__,
                "message": result.message,
            },
        )
    return result


def run_partition_maintenance_gracefully(*, months_ahead: int = 2) -> PartitionMaintenanceResult:
    """Startup-safe wrapper using an isolated session."""

    from app.database import SessionLocal

    db = SessionLocal()
    try:
        out = run_partition_maintenance(db, months_ahead=months_ahead)
        if out.status == "ok":
            logger.info("%s", {"stage": "partition_maintenance_ok", "partitions": out.ensured_partitions})
        return out
    finally:
        db.close()


__all__ = [
    "PartitionMaintenanceResult",
    "PartitionObservabilitySnapshot",
    "PartitionStatusRow",
    "build_partition_observability",
    "collect_delivery_log_partition_status",
    "delivery_logs_is_partitioned",
    "delivery_logs_partition_key",
    "run_partition_maintenance",
    "run_partition_maintenance_gracefully",
]
