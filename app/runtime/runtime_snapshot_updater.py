"""Incremental operational snapshot updater (fail-open, no StreamRunner coupling)."""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.config import settings
from app.runtime.runtime_snapshot_repository import SnapshotUpdateResult, recompute_and_upsert_snapshots

logger = logging.getLogger(__name__)

_process_lock = threading.Lock()
_update_in_progress = False


@dataclass(frozen=True)
class RuntimeSnapshotUpdateOutcome:
    result: SnapshotUpdateResult | None
    skipped_overlap: bool
    error: str | None = None


def _updater_enabled() -> bool:
    return bool(getattr(settings, "GDC_RUNTIME_OPERATIONAL_SNAPSHOT_UPDATER_ENABLED", True))


def _scan_minutes() -> int:
    return max(5, int(getattr(settings, "GDC_RUNTIME_OPERATIONAL_SNAPSHOT_SCAN_MINUTES", 15)))


def run_runtime_snapshot_update(
    db: Session,
    *,
    bootstrap_last_outcomes: bool = False,
) -> RuntimeSnapshotUpdateOutcome:
    """Run one snapshot refresh cycle; returns without raising on failure."""

    global _update_in_progress
    if not _updater_enabled():
        return RuntimeSnapshotUpdateOutcome(result=None, skipped_overlap=False, error="updater_disabled")

    if not _process_lock.acquire(blocking=False):
        logger.info("%s", {"stage": "runtime_snapshot_update_skipped", "reason": "overlap"})
        return RuntimeSnapshotUpdateOutcome(result=None, skipped_overlap=True)

    try:
        if _update_in_progress:
            logger.info("%s", {"stage": "runtime_snapshot_update_skipped", "reason": "overlap"})
            return RuntimeSnapshotUpdateOutcome(result=None, skipped_overlap=True)
        _update_in_progress = True
        logger.info("%s", {"stage": "runtime_snapshot_update_started"})
        try:
            result = recompute_and_upsert_snapshots(
                db,
                scan_minutes=_scan_minutes(),
                bootstrap_last_outcomes=bootstrap_last_outcomes,
            )
            db.commit()
            logger.info(
                "%s",
                {
                    "stage": "runtime_snapshot_update_finished",
                    "stream_rows": result.stream_rows,
                    "route_rows": result.route_rows,
                    "destination_rows": result.destination_rows,
                    "deleted_stream_rows": result.deleted_stream_rows,
                    "deleted_route_rows": result.deleted_route_rows,
                    "deleted_destination_rows": result.deleted_destination_rows,
                },
            )
            logger.info(
                "%s",
                {
                    "stage": "runtime_snapshot_rows_updated",
                    "stream_rows": result.stream_rows,
                    "route_rows": result.route_rows,
                    "destination_rows": result.destination_rows,
                },
            )
            return RuntimeSnapshotUpdateOutcome(result=result, skipped_overlap=False)
        except Exception as exc:
            db.rollback()
            logger.exception(
                "%s",
                {
                    "stage": "runtime_snapshot_update_failed",
                    "error_type": type(exc).__name__,
                    "message": str(exc),
                },
            )
            return RuntimeSnapshotUpdateOutcome(result=None, skipped_overlap=False, error=str(exc))
    finally:
        _update_in_progress = False
        _process_lock.release()


def reset_updater_overlap_guard_for_tests() -> None:
    """Test helper: clear in-process overlap guard."""

    global _update_in_progress
    _update_in_progress = False
