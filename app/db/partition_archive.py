"""Export-ready archival foundation for partitioned operational tables.

Cold storage (S3, object store) is not implemented here. This module defines the
detach/export workflow hooks operators can wire to external backup pipelines later.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Protocol

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.delivery_log_partitions import (
    list_delivery_log_monthly_partitions,
    partition_month_from_name,
    quote_delivery_log_partition_ident,
)

logger = logging.getLogger(__name__)


class ColdStorageExporter(Protocol):
    """Future integration point for S3/object-store upload after local export."""

    def upload_partition_export(self, *, local_path: str, object_key: str, metadata: dict[str, Any]) -> str:
        """Upload a prepared export file; return the remote URI."""


@dataclass(frozen=True)
class PartitionArchiveTarget:
    """A monthly child partition prepared for optional detach + export."""

    parent_table: str
    partition_name: str
    month_start: date
    month_end: date
    row_count: int
    detach_sql: str
    export_format: str = "pg_dump_custom"
    compression_hint: str = "gzip"


@dataclass
class PartitionArchivePlan:
    """Dry-run or execution plan for one or more archive targets."""

    targets: list[PartitionArchiveTarget] = field(default_factory=list)
    notes: dict[str, Any] = field(default_factory=dict)


@dataclass
class PartitionArchiveOutcome:
    """Result of an archive workflow step."""

    partition_name: str
    status: str
    message: str = ""
    detached: bool = False
    export_path: str | None = None
    remote_uri: str | None = None
    notes: dict[str, Any] = field(default_factory=dict)


def build_delivery_log_archive_targets(
    db: Session,
    *,
    retention_days: int,
    now: date | None = None,
) -> PartitionArchivePlan:
    """List whole-month partitions eligible for archival before destructive drop.

    Uses the same month-boundary rules as partition retention drop planning.
    """

    from datetime import datetime, timezone

    from app.db.delivery_log_partitions import calculate_delivery_log_partition_drop_targets

    ref = now or datetime.now(timezone.utc)
    drop_targets = calculate_delivery_log_partition_drop_targets(
        db,
        retention_days=retention_days,
        now=ref,
    )
    targets: list[PartitionArchiveTarget] = []
    for t in drop_targets:
        quoted = quote_delivery_log_partition_ident(t.partition_name)
        targets.append(
            PartitionArchiveTarget(
                parent_table="delivery_logs",
                partition_name=t.partition_name,
                month_start=t.month_start,
                month_end=t.month_end,
                row_count=t.row_count,
                detach_sql=f"ALTER TABLE delivery_logs DETACH PARTITION {quoted};",
            )
        )
    return PartitionArchivePlan(
        targets=targets,
        notes={
            "retention_days": retention_days,
            "export_placeholder": "Use pg_dump -Fc -t <partition> or COPY TO PROGRAM gzip for offline export.",
            "s3_integration": "Implement ColdStorageExporter and call upload_partition_export after local export.",
        },
    )


def compress_export_hook(*, source_path: str, destination_path: str) -> str:
    """Placeholder hook for gzip compression before cold storage upload.

    Production operators should replace this with their backup tooling. The default
    implementation returns the source path unchanged so tests stay portable.
    """

    _ = destination_path
    return source_path


def detach_delivery_log_partition(db: Session, partition_name: str, *, dry_run: bool = True) -> PartitionArchiveOutcome:
    """Detach one monthly delivery_logs child partition from the parent table."""

    month_start = partition_month_from_name(partition_name)
    if month_start is None:
        return PartitionArchiveOutcome(
            partition_name=partition_name,
            status="error",
            message="partition name is not a canonical delivery_logs monthly partition",
        )
    quoted = quote_delivery_log_partition_ident(partition_name)
    sql = f"ALTER TABLE delivery_logs DETACH PARTITION {quoted}"
    if dry_run:
        return PartitionArchiveOutcome(
            partition_name=partition_name,
            status="dry_run",
            message="detach skipped (dry_run=true)",
            detached=False,
            notes={"detach_sql": sql},
        )
    db.execute(text(sql))
    return PartitionArchiveOutcome(
        partition_name=partition_name,
        status="ok",
        message="partition detached",
        detached=True,
        notes={"detach_sql": sql},
    )


def export_partition_placeholder(
    db: Session,
    target: PartitionArchiveTarget,
    *,
    exporter: ColdStorageExporter | None = None,
    dry_run: bool = True,
) -> PartitionArchiveOutcome:
    """Prepare export metadata; optional future cold-storage upload."""

    local_path = f"/var/lib/gdc/archive/{target.partition_name}.dump"
    compressed = compress_export_hook(source_path=local_path, destination_path=f"{local_path}.gz")
    remote_uri: str | None = None
    if exporter is not None and not dry_run:
        remote_uri = exporter.upload_partition_export(
            local_path=compressed,
            object_key=f"delivery_logs/{target.partition_name}.dump.gz",
            metadata={
                "parent_table": target.parent_table,
                "month_start": target.month_start.isoformat(),
                "month_end": target.month_end.isoformat(),
                "row_count": target.row_count,
            },
        )
    return PartitionArchiveOutcome(
        partition_name=target.partition_name,
        status="dry_run" if dry_run else "ok",
        message="export planned" if dry_run else "export metadata recorded",
        export_path=compressed,
        remote_uri=remote_uri,
        notes={
            "export_format": target.export_format,
            "compression_hint": target.compression_hint,
            "row_count": target.row_count,
        },
    )


def detect_orphan_delivery_log_partitions(db: Session) -> list[str]:
    """Return child relnames attached to delivery_logs that are not canonical monthly names."""

    orphans: list[str] = []
    rows = db.execute(
        text(
            """
            SELECT child.relname
            FROM pg_inherits
            JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
            JOIN pg_class child ON child.oid = pg_inherits.inhrelid
            WHERE parent.relname = 'delivery_logs'
            ORDER BY child.relname
            """
        )
    ).fetchall()
    allowed = {name for name, _ in list_delivery_log_monthly_partitions(db)}
    allowed.add("delivery_logs_default")
    for row in rows:
        name = str(row[0])
        if name not in allowed:
            orphans.append(name)
    return orphans


__all__ = [
    "ColdStorageExporter",
    "PartitionArchiveOutcome",
    "PartitionArchivePlan",
    "PartitionArchiveTarget",
    "build_delivery_log_archive_targets",
    "compress_export_hook",
    "detach_delivery_log_partition",
    "detect_orphan_delivery_log_partitions",
    "export_partition_placeholder",
]
