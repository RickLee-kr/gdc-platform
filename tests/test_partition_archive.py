"""Archival foundation tests (detach/export hooks; no S3)."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.db.partition_archive import (
    build_delivery_log_archive_targets,
    compress_export_hook,
    detach_delivery_log_partition,
    detect_orphan_delivery_log_partitions,
    export_partition_placeholder,
)
from app.db.delivery_log_partitions import ensure_delivery_log_partitions

UTC = timezone.utc


def test_build_archive_targets_respects_protected_months(db_session: Session) -> None:
    ensure_delivery_log_partitions(db_session, start_month=datetime(2026, 1, 1, tzinfo=UTC), months_ahead=5)
    db_session.commit()
    plan = build_delivery_log_archive_targets(db_session, retention_days=60, now=datetime(2026, 5, 17, tzinfo=UTC))
    names = {t.partition_name for t in plan.targets}
    assert "delivery_logs_2026_01" in names
    assert "delivery_logs_2026_05" not in names
    assert "delivery_logs_2026_06" not in names
    assert plan.notes.get("s3_integration")


def test_detach_partition_dry_run(db_session: Session) -> None:
    ensure_delivery_log_partitions(db_session, start_month=datetime(2026, 3, 1, tzinfo=UTC), months_ahead=0)
    db_session.commit()
    out = detach_delivery_log_partition(db_session, "delivery_logs_2026_03", dry_run=True)
    assert out.status == "dry_run"
    assert out.detached is False
    assert "DETACH PARTITION" in out.notes.get("detach_sql", "")


def test_export_placeholder_dry_run(db_session: Session) -> None:
    plan = build_delivery_log_archive_targets(db_session, retention_days=3650, now=datetime(2026, 5, 1, tzinfo=UTC))
    if not plan.targets:
        return
    out = export_partition_placeholder(db_session, plan.targets[0], dry_run=True)
    assert out.status == "dry_run"
    assert out.export_path


def test_compress_export_hook_identity() -> None:
    assert compress_export_hook(source_path="/tmp/a.dump", destination_path="/tmp/a.dump.gz") == "/tmp/a.dump"


def test_orphan_detection_allows_default(db_session: Session) -> None:
    orphans = detect_orphan_delivery_log_partitions(db_session)
    assert "delivery_logs_default" not in orphans
