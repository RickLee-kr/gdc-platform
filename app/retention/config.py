"""Default operational retention windows (PostgreSQL-only; lightweight cleanup).

``delivery_logs_days`` defaults to **30** days at the code level; the active value is the
``platform_retention_policy.logs_retention_days`` row (merged in :func:`effective_retention_policies`).
Deletes are applied in bounded batches via :func:`app.retention.batch.batch_delete_by_time_before`.
"""

from __future__ import annotations

from app.config import settings
from app.platform_admin.models import PlatformRetentionPolicy

# Code defaults (days). Row-level policy overrides delivery_logs and runtime_metrics.
DEFAULT_RETENTION_POLICIES: dict[str, int] = {
    "delivery_logs_days": 30,
    "backfill_jobs_days": 14,
    "backfill_progress_events_days": 14,
    "validation_snapshots_days": 7,
    "runtime_metrics_days": 30,
}


def effective_retention_policies(row: PlatformRetentionPolicy) -> dict[str, int]:
    """Merge platform row, optional env overrides, and built-in defaults."""

    out = dict(DEFAULT_RETENTION_POLICIES)
    out["delivery_logs_days"] = max(1, int(row.logs_retention_days))
    out["runtime_metrics_days"] = max(1, int(row.runtime_metrics_retention_days))
    bf = settings.GDC_RETENTION_BACKFILL_JOBS_DAYS
    if bf is not None:
        out["backfill_jobs_days"] = max(1, int(bf))
    else:
        out["backfill_jobs_days"] = max(1, int(DEFAULT_RETENTION_POLICIES["backfill_jobs_days"]))
    bpe = settings.GDC_RETENTION_BACKFILL_PROGRESS_EVENTS_DAYS
    if bpe is not None:
        out["backfill_progress_events_days"] = max(1, int(bpe))
    else:
        out["backfill_progress_events_days"] = max(1, int(DEFAULT_RETENTION_POLICIES["backfill_progress_events_days"]))
    vs = settings.GDC_RETENTION_VALIDATION_SNAPSHOTS_DAYS
    if vs is not None:
        out["validation_snapshots_days"] = max(1, int(vs))
    else:
        out["validation_snapshots_days"] = max(1, int(DEFAULT_RETENTION_POLICIES["validation_snapshots_days"]))
    return out


def supplement_interval_seconds() -> float:
    return float(settings.GDC_OPERATIONAL_RETENTION_INTERVAL_SEC or 86400.0)


__all__ = ["DEFAULT_RETENTION_POLICIES", "effective_retention_policies", "supplement_interval_seconds"]
