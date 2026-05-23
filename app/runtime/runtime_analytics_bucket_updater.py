"""Incremental analytics bucket updater (fail-open, no StreamRunner coupling)."""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.config import settings
from app.runtime.runtime_analytics_bucket_repository import (
    AnalyticsBucketRetentionResult,
    AnalyticsBucketUpdateResult,
    prune_analytics_buckets,
    recompute_and_upsert_analytics_buckets,
)

logger = logging.getLogger(__name__)

_process_lock = threading.Lock()
_update_in_progress = False


@dataclass(frozen=True)
class RuntimeAnalyticsBucketUpdateOutcome:
    result: AnalyticsBucketUpdateResult | None
    retention: AnalyticsBucketRetentionResult | None
    skipped_overlap: bool
    error: str | None = None


def _updater_enabled() -> bool:
    return bool(getattr(settings, "GDC_RUNTIME_ANALYTICS_BUCKET_UPDATER_ENABLED", True))


def _batch_limit() -> int:
    return max(1000, int(getattr(settings, "GDC_RUNTIME_ANALYTICS_BUCKET_BATCH_LIMIT", 50_000)))


def _bootstrap_minutes() -> int:
    return max(15, int(getattr(settings, "GDC_RUNTIME_ANALYTICS_BUCKET_BOOTSTRAP_MINUTES", 60)))


def _retention_enabled() -> bool:
    return bool(getattr(settings, "GDC_RUNTIME_ANALYTICS_BUCKET_RETENTION_CLEANUP_ENABLED", True))


def run_runtime_analytics_bucket_update(db: Session) -> RuntimeAnalyticsBucketUpdateOutcome:
    """Run one bucket refresh cycle; returns without raising on failure."""

    global _update_in_progress
    if not _updater_enabled():
        return RuntimeAnalyticsBucketUpdateOutcome(
            result=None, retention=None, skipped_overlap=False, error="updater_disabled"
        )

    if not _process_lock.acquire(blocking=False):
        logger.info("%s", {"stage": "runtime_analytics_bucket_update_skipped", "reason": "overlap"})
        return RuntimeAnalyticsBucketUpdateOutcome(result=None, retention=None, skipped_overlap=True)

    try:
        if _update_in_progress:
            logger.info("%s", {"stage": "runtime_analytics_bucket_update_skipped", "reason": "overlap"})
            return RuntimeAnalyticsBucketUpdateOutcome(result=None, retention=None, skipped_overlap=True)
        _update_in_progress = True
        logger.info("%s", {"stage": "runtime_analytics_bucket_update_started"})
        try:
            result = recompute_and_upsert_analytics_buckets(
                db,
                batch_limit=_batch_limit(),
                bootstrap_minutes=_bootstrap_minutes(),
            )
            retention: AnalyticsBucketRetentionResult | None = None
            if _retention_enabled():
                retention = prune_analytics_buckets(
                    db,
                    retention_1m_days=int(
                        getattr(settings, "GDC_RUNTIME_ANALYTICS_BUCKET_1M_RETENTION_DAYS", 30)
                    ),
                    retention_5m_days=int(
                        getattr(settings, "GDC_RUNTIME_ANALYTICS_BUCKET_5M_RETENTION_DAYS", 90)
                    ),
                    batch_size=int(getattr(settings, "GDC_RUNTIME_ANALYTICS_BUCKET_RETENTION_BATCH_SIZE", 10_000)),
                )
            db.commit()
            logger.info(
                "%s",
                {
                    "stage": "runtime_analytics_bucket_update_finished",
                    "rows_1m": result.rows_1m,
                    "rows_5m": result.rows_5m,
                    "logs_processed": result.logs_processed,
                    "max_log_id": result.max_log_id,
                    "deleted_1m": retention.deleted_1m if retention else 0,
                    "deleted_5m": retention.deleted_5m if retention else 0,
                },
            )
            return RuntimeAnalyticsBucketUpdateOutcome(
                result=result, retention=retention, skipped_overlap=False
            )
        except Exception as exc:
            db.rollback()
            logger.exception(
                "%s",
                {
                    "stage": "runtime_analytics_bucket_update_failed",
                    "error_type": type(exc).__name__,
                    "message": str(exc),
                },
            )
            return RuntimeAnalyticsBucketUpdateOutcome(
                result=None, retention=None, skipped_overlap=False, error=str(exc)
            )
    finally:
        _update_in_progress = False
        _process_lock.release()


def reset_analytics_bucket_overlap_guard_for_tests() -> None:
    """Test helper: clear in-process overlap guard."""

    global _update_in_progress
    _update_in_progress = False
