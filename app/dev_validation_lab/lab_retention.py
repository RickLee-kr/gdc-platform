"""Lab-mode retention preview and gated cleanup.

Destructive deletes require ``execute=True`` (CLI ``--execute``) or
``GDC_LAB_RETENTION_AUTOMATIC_CLEANUP=true`` (default) for the scheduler path.
Never drops the current-month ``delivery_logs`` partition.
E2E / lab operational rows default to a short retention window so disk stays bounded.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.db.delivery_log_partitions import calculate_delivery_log_partition_drop_targets
from app.dev_validation_lab.seeder import lab_effective
from app.logs.models import DeliveryLog
from app.platform_admin.models import PlatformAlertHistory
from app.replay.models import StreamReplayEvent
from app.retention.batch import batch_delete_by_time_before, eligible_count_and_oldest
from app.validation.models import ValidationRun

logger = logging.getLogger(__name__)

UTC = timezone.utc

_last_cleanup_at: datetime | None = None
_last_cleanup_result: dict[str, Any] | None = None


def lab_retention_settings() -> dict[str, Any]:
    """Return retention day knobs and whether lab retention is active."""

    enabled = bool(lab_effective() and bool(getattr(settings, "GDC_LAB_RETENTION_ENABLED", True)))
    return {
        "enabled": enabled,
        "lab_effective": bool(lab_effective()),
        "GDC_LAB_RETENTION_ENABLED": bool(getattr(settings, "GDC_LAB_RETENTION_ENABLED", True)),
        "GDC_LAB_RETENTION_AUTOMATIC_CLEANUP": bool(
            getattr(settings, "GDC_LAB_RETENTION_AUTOMATIC_CLEANUP", True)
        ),
        "delivery_log_retention_days": int(getattr(settings, "GDC_LAB_DELIVERY_LOG_RETENTION_DAYS", 1) or 1),
        "alert_history_retention_days": int(
            getattr(settings, "GDC_LAB_ALERT_HISTORY_RETENTION_DAYS", 1) or 1
        ),
        "replay_event_retention_days": int(
            getattr(settings, "GDC_LAB_REPLAY_EVENT_RETENTION_DAYS", 1) or 1
        ),
        "validation_run_retention_days": int(
            getattr(settings, "GDC_LAB_VALIDATION_RUN_RETENTION_DAYS", 1) or 1
        ),
        "batch_size": int(getattr(settings, "GDC_LAB_RETENTION_BATCH_SIZE", 5000) or 5000),
    }


def last_lab_cleanup_snapshot() -> dict[str, Any]:
    return {
        "last_cleanup_at": _last_cleanup_at.isoformat() if _last_cleanup_at else None,
        "last_cleanup_result": dict(_last_cleanup_result) if _last_cleanup_result else None,
    }


def _cutoff(days: int) -> datetime:
    return datetime.now(UTC) - timedelta(days=max(1, int(days)))


def _relation_size_bytes(db: Session, relation: str) -> int | None:
    try:
        # Identifiers are fixed table names from this module only.
        val = db.execute(text(f"SELECT pg_total_relation_size('{relation}'::regclass)")).scalar()
        return int(val) if val is not None else None
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        return None


def preview_lab_cleanup(db: Session) -> dict[str, Any]:
    """Dry-run stats: eligible rows, partition drop candidates, cheap size estimates."""

    cfg = lab_retention_settings()
    now = datetime.now(UTC)
    tables: list[dict[str, Any]] = []
    errors: list[str] = []

    if not cfg["enabled"]:
        return {
            "generated_at": now.isoformat(),
            "execute": False,
            "retention": cfg,
            "tables": [],
            "partition_drop_candidates": [],
            "estimated_sizes": {},
            "message": "lab retention disabled (lab_effective and GDC_LAB_RETENTION_ENABLED required)",
            "errors": errors,
        }

    try:
        c_logs = _cutoff(cfg["delivery_log_retention_days"])
        n_logs, oldest_logs = eligible_count_and_oldest(
            db, model=DeliveryLog, time_column=DeliveryLog.created_at, cutoff=c_logs
        )
        tables.append(
            {
                "table": "delivery_logs",
                "rows_eligible": n_logs,
                "oldest_row_timestamp": oldest_logs.isoformat() if oldest_logs else None,
                "retention_days": cfg["delivery_log_retention_days"],
                "cutoff_utc": c_logs.isoformat(),
            }
        )
    except Exception as exc:
        errors.append(f"delivery_logs preview: {type(exc).__name__}: {exc}")
        try:
            db.rollback()
        except Exception:
            pass

    try:
        c_alert = _cutoff(cfg["alert_history_retention_days"])
        n_alert, oldest_alert = eligible_count_and_oldest(
            db,
            model=PlatformAlertHistory,
            time_column=PlatformAlertHistory.created_at,
            cutoff=c_alert,
        )
        tables.append(
            {
                "table": "platform_alert_history",
                "rows_eligible": n_alert,
                "oldest_row_timestamp": oldest_alert.isoformat() if oldest_alert else None,
                "retention_days": cfg["alert_history_retention_days"],
                "cutoff_utc": c_alert.isoformat(),
            }
        )
    except Exception as exc:
        errors.append(f"platform_alert_history preview: {type(exc).__name__}: {exc}")
        try:
            db.rollback()
        except Exception:
            pass

    try:
        c_replay = _cutoff(cfg["replay_event_retention_days"])
        n_replay, oldest_replay = eligible_count_and_oldest(
            db,
            model=StreamReplayEvent,
            time_column=StreamReplayEvent.created_at,
            cutoff=c_replay,
        )
        tables.append(
            {
                "table": "stream_replay_events",
                "rows_eligible": n_replay,
                "oldest_row_timestamp": oldest_replay.isoformat() if oldest_replay else None,
                "retention_days": cfg["replay_event_retention_days"],
                "cutoff_utc": c_replay.isoformat(),
            }
        )
    except Exception as exc:
        errors.append(f"stream_replay_events preview: {type(exc).__name__}: {exc}")
        try:
            db.rollback()
        except Exception:
            pass

    try:
        c_val = _cutoff(cfg["validation_run_retention_days"])
        n_val, oldest_val = eligible_count_and_oldest(
            db,
            model=ValidationRun,
            time_column=ValidationRun.created_at,
            cutoff=c_val,
        )
        tables.append(
            {
                "table": "validation_runs",
                "rows_eligible": n_val,
                "oldest_row_timestamp": oldest_val.isoformat() if oldest_val else None,
                "retention_days": cfg["validation_run_retention_days"],
                "cutoff_utc": c_val.isoformat(),
            }
        )
    except Exception as exc:
        errors.append(f"validation_runs preview: {type(exc).__name__}: {exc}")
        try:
            db.rollback()
        except Exception:
            pass

    partition_candidates: list[dict[str, Any]] = []
    try:
        from app.dev_validation_lab.lab_cleanup_recoverability import enrich_partition_drop_candidates

        partition_candidates = enrich_partition_drop_candidates(
            db,
            retention_days=int(cfg["delivery_log_retention_days"]),
            now=now,
            cheap=True,
        )
    except Exception as exc:
        errors.append(f"partition_drop_candidates: {type(exc).__name__}: {exc}")
        try:
            db.rollback()
        except Exception:
            pass
        # Fallback to legacy thin candidates if enrich fails.
        try:
            targets = calculate_delivery_log_partition_drop_targets(
                db,
                retention_days=cfg["delivery_log_retention_days"],
                now=now,
            )
            partition_candidates = [
                {
                    "partition_name": t.partition_name,
                    "estimated_rows": t.row_count,
                    "row_count": t.row_count,
                    "month_start": t.month_start.isoformat(),
                    "month_end": t.month_end.isoformat(),
                    "retention_cutoff": t.cutoff_utc.isoformat(),
                    "safe_to_drop_candidate": True,
                    "reason": "fully_older_than_retention_cutoff_safe_drop_candidate",
                    "estimated_size_bytes": None,
                    "min_created_at": None,
                    "max_created_at": None,
                }
                for t in targets
            ]
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass

    estimated_sizes = {
        "delivery_logs": _relation_size_bytes(db, "delivery_logs"),
        "platform_alert_history": _relation_size_bytes(db, "platform_alert_history"),
        "stream_replay_events": _relation_size_bytes(db, "stream_replay_events"),
        "validation_runs": _relation_size_bytes(db, "validation_runs"),
    }

    return {
        "generated_at": now.isoformat(),
        "execute": False,
        "retention": cfg,
        "tables": tables,
        "partition_drop_candidates": partition_candidates,
        "protected_partitions_note": "current and next month delivery_logs partitions are never dropped",
        "estimated_sizes_bytes": estimated_sizes,
        "vacuum_analyze_recommendation": (
            "After --execute deletes, consider: VACUUM (ANALYZE) delivery_logs; "
            "VACUUM (ANALYZE) platform_alert_history; VACUUM (ANALYZE) stream_replay_events; "
            "VACUUM (ANALYZE) validation_runs;"
        ),
        "errors": errors,
    }


def execute_lab_cleanup(db: Session, *, execute: bool = False) -> dict[str, Any]:
    """Preview always; delete only when ``execute`` is True.

    Does not DROP partitions (preview lists candidates only). Batched row deletes
    for alert history, replay events, and delivery_logs.
    """

    global _last_cleanup_at, _last_cleanup_result

    preview = preview_lab_cleanup(db)
    if not execute:
        preview["message"] = "dry-run only; pass execute=True or CLI --execute to delete"
        return preview

    cfg = lab_retention_settings()
    if not cfg["enabled"]:
        preview["message"] = "refusing execute: lab retention not enabled"
        preview["execute"] = False
        return preview

    outcomes: list[dict[str, Any]] = []
    errors: list[str] = list(preview.get("errors") or [])
    batch_size = int(cfg["batch_size"])

    def _run_delete(table: str, model: type, time_column: Any, days: int) -> None:
        cutoff = _cutoff(days)
        try:
            matched, deleted = batch_delete_by_time_before(
                db,
                model=model,
                time_column=time_column,
                cutoff=cutoff,
                batch_size=batch_size,
                dry_run=False,
            )
            outcomes.append(
                {
                    "table": table,
                    "status": "ok",
                    "matched_count": matched,
                    "deleted_count": deleted,
                    "cutoff_utc": cutoff.isoformat(),
                }
            )
        except Exception as exc:
            try:
                db.rollback()
            except Exception:
                pass
            msg = f"{type(exc).__name__}: {exc}"
            errors.append(f"{table} delete: {msg}")
            outcomes.append(
                {
                    "table": table,
                    "status": "error",
                    "matched_count": 0,
                    "deleted_count": 0,
                    "message": msg,
                }
            )

    _run_delete(
        "platform_alert_history",
        PlatformAlertHistory,
        PlatformAlertHistory.created_at,
        cfg["alert_history_retention_days"],
    )
    _run_delete(
        "stream_replay_events",
        StreamReplayEvent,
        StreamReplayEvent.created_at,
        cfg["replay_event_retention_days"],
    )
    _run_delete(
        "validation_runs",
        ValidationRun,
        ValidationRun.created_at,
        cfg["validation_run_retention_days"],
    )
    _run_delete(
        "delivery_logs",
        DeliveryLog,
        DeliveryLog.created_at,
        cfg["delivery_log_retention_days"],
    )

    result = {
        **preview,
        "execute": True,
        "outcomes": outcomes,
        "errors": errors,
        "partition_drop_performed": False,
        "message": "lab cleanup executed (row deletes only; partitions not dropped)",
        "vacuum_analyze_recommendation": preview.get("vacuum_analyze_recommendation"),
    }
    _last_cleanup_at = datetime.now(UTC)
    _last_cleanup_result = {
        "execute": True,
        "outcomes": outcomes,
        "errors": errors,
        "at": _last_cleanup_at.isoformat(),
    }
    logger.info(
        "%s",
        {
            "stage": "lab_retention_cleanup_executed",
            "outcomes": outcomes,
            "errors": errors,
        },
    )
    return result


def run_scheduled_lab_cleanup(db: Session) -> dict[str, Any]:
    """Scheduler entry: always preview/log; execute only when automatic cleanup is on.

    Safe auto cleanup (when enabled) deletes retention-aged rows only — never
    DROP/TRUNCATE/VACUUM FULL. On execute failure, lab generation is paused.
    """

    cfg = lab_retention_settings()
    if not cfg["enabled"]:
        return {"skipped": True, "reason": "lab_retention_disabled"}

    preview = preview_lab_cleanup(db)
    logger.info(
        "%s",
        {
            "stage": "lab_retention_cleanup_dry_run",
            "tables": preview.get("tables"),
            "partition_drop_candidates": preview.get("partition_drop_candidates"),
            "automatic_cleanup": cfg["GDC_LAB_RETENTION_AUTOMATIC_CLEANUP"],
        },
    )
    if not cfg["GDC_LAB_RETENTION_AUTOMATIC_CLEANUP"]:
        return {**preview, "skipped_execute": True, "reason": "automatic_cleanup_disabled"}

    result = execute_lab_cleanup(db, execute=True)
    errors = list(result.get("errors") or [])
    if errors:
        try:
            from app.dev_validation_lab.lab_resource_guardrail import mark_cleanup_failed_pause

            mark_cleanup_failed_pause("; ".join(str(e) for e in errors[:3]))
        except Exception:  # pragma: no cover - defensive
            pass
        result["cleanup_failed_pause"] = True
    else:
        # Force budget re-check so lab can auto-resume after successful cleanup.
        try:
            from app.dev_validation_lab.lab_resource_guardrail import check_lab_resource_budget

            check_lab_resource_budget(db, force=True, attempt_wiremock_reset=False)
        except Exception:  # pragma: no cover - defensive
            pass
    return result


__all__ = [
    "execute_lab_cleanup",
    "lab_retention_settings",
    "last_lab_cleanup_snapshot",
    "preview_lab_cleanup",
    "run_scheduled_lab_cleanup",
]
