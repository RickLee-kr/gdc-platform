"""Read-only maintenance health aggregation for administrators (no writes, no checkpoints)."""

from __future__ import annotations

import logging
import shutil
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.admin.support_bundle import _safe_text
from app.config import settings
from app.logs.models import DeliveryLog
from app.platform_admin.cleanup_scheduler import get_cleanup_scheduler
from app.platform_admin.cert_service import read_certificate_not_after_pem
from app.platform_admin.delivery_logs_index_probe import probe_delivery_logs_indexes
from app.platform_admin.pg_stat_statements_probe import fetch_pg_stat_statements_top, probe_pg_stat_statements
from app.db.partition_maintenance import build_partition_observability
from app.db.partition_maintenance_scheduler import get_partition_maintenance_scheduler
from app.platform_admin.repository import get_https_config_row, get_retention_policy_row
from app.retention.config import effective_retention_policies
from app.runtime.health_repository import (
    fetch_destination_health_aggregates,
    fetch_destination_lookup,
    normalize_aggregate_row,
)
from app.scheduler import runtime_state as scheduler_runtime_state
from app.security.secrets import mask_secrets_and_pem, redact_pem_literals
from app.db.migration_integrity import evaluate_migration_integrity, load_script_directory, project_root
from app.startup_readiness import evaluate_schema_with_engine, get_startup_snapshot
from app.database import engine

logger = logging.getLogger(__name__)

_FAIL_STAGES = frozenset(
    {
        "route_send_failed",
        "route_retry_failed",
        "route_unknown_failure_policy",
    }
)
_WINDOW = timedelta(hours=1)
_ROOT = Path(__file__).resolve().parents[2]


def _mask_database_url(url: str) -> str:
    try:
        p = urlparse(url)
        if p.password:
            netloc = p.netloc.replace(f":{p.password}@", ":****@")
            return p._replace(netloc=netloc).geturl()
    except Exception:
        pass
    return "****"


def _alembic_script_heads() -> tuple[str, ...]:
    try:
        return tuple(load_script_directory(project_root()).get_heads())
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("%s", {"stage": "maintenance_alembic_heads_failed", "error": str(exc)})
        return ()


def _disk_summary() -> dict[str, Any]:
    path = "/"
    try:
        usage = shutil.disk_usage(path)
        return {
            "path": path,
            "total_bytes": int(usage.total),
            "used_bytes": int(usage.used),
            "free_bytes": int(usage.free),
            "used_percent": round(100.0 * float(usage.used) / float(usage.total), 2) if usage.total else None,
        }
    except Exception as exc:
        return {"path": path, "error": str(exc)[:200]}


def _safe_failure_message(msg: str) -> str:
    s = redact_pem_literals(str(msg) if msg else "")
    if not isinstance(s, str):
        s = str(s)
    if len(s) > 400:
        s = s[:400] + "…"
    return s


def build_maintenance_health(db: Session) -> dict[str, Any]:
    """Assemble maintenance panels and OK/WARN/ERROR notice lists (read-only)."""

    now = datetime.now(timezone.utc)
    ok: list[dict[str, str]] = []
    warn: list[dict[str, str]] = []
    error: list[dict[str, str]] = []

    # --- Database ---
    db_latency_ms: float | None = None
    db_reachable = False
    db_version: str | None = None
    t0 = time.perf_counter()
    try:
        db.execute(text("SELECT 1"))
        db_reachable = True
        db_latency_ms = round((time.perf_counter() - t0) * 1000.0, 1)
        db_version = str(db.execute(text("SELECT version()")).scalar() or "")
    except Exception as exc:
        error.append(
            {
                "code": "DB_UNREACHABLE",
                "message": "PostgreSQL probe failed for this API process.",
                "panel": "database",
            }
        )
        logger.info("%s", {"stage": "maintenance_db_probe_failed", "error_type": type(exc).__name__})

    if db_reachable:
        ok.append({"code": "DB_REACHABLE", "message": "PostgreSQL responded to a lightweight probe.", "panel": "database"})
        if db_latency_ms is not None and db_latency_ms >= 200:
            warn.append(
                {
                    "code": "DB_LATENCY_HIGH",
                    "message": f"DB probe latency {db_latency_ms} ms (threshold 200 ms).",
                    "panel": "database",
                }
            )

    db_panel_status: Literal["OK", "WARN", "ERROR"] = "ERROR" if not db_reachable else ("WARN" if any(w["panel"] == "database" for w in warn) else "OK")
    database_panel: dict[str, Any] = {
        "status": db_panel_status,
        "reachable": db_reachable,
        "latency_ms": db_latency_ms,
        "database_url_masked": _mask_database_url(str(settings.DATABASE_URL or "")),
        "version_short": (db_version or "").split(",")[0].strip() if db_version else None,
    }

    # --- Migrations (Alembic) ---
    script_heads = _alembic_script_heads()
    db_rev: str | None = None
    schema_ok_live = False
    if db_reachable:
        try:
            schema_ok_live, _missing, db_rev, _conn_err = evaluate_schema_with_engine(engine)
        except Exception:
            db_rev = None
            schema_ok_live = False

    migration_status: Literal["OK", "WARN", "ERROR"] = "OK"
    if not db_reachable:
        migration_status = "ERROR"
        error.append(
            {
                "code": "MIGRATIONS_DB_UNAVAILABLE",
                "message": "Cannot verify Alembic migration state while the database is unreachable.",
                "panel": "migrations",
            }
        )
    elif not script_heads:
        migration_status = "WARN"
        warn.append(
            {
                "code": "ALEMBIC_HEADS_UNAVAILABLE",
                "message": "Could not read Alembic script heads from the deployment (check alembic.ini path).",
                "panel": "migrations",
            }
        )
    elif db_rev is None:
        migration_status = "ERROR"
        error.append(
            {
                "code": "ALEMBIC_NOT_STAMPED",
                "message": "No row in alembic_version — database may not be migrated.",
                "panel": "migrations",
            }
        )
    elif len(script_heads) > 1:
        migration_status = "ERROR"
        error.append(
            {
                "code": "ALEMBIC_MULTIPLE_HEADS",
                "message": f"Multiple Alembic heads in repo: {', '.join(script_heads)}.",
                "panel": "migrations",
            }
        )
    elif db_rev not in script_heads:
        mig = evaluate_migration_integrity(
            engine,
            database_url=str(settings.DATABASE_URL or ""),
            pre_upgrade=False,
        )
        if mig.db_revision_is_known_orphan or not mig.db_revision_in_repo:
            migration_status = "ERROR"
            error.append(
                {
                    "code": "ALEMBIC_ORPHAN_REVISION",
                    "message": mig.errors[0] if mig.errors else f"Orphan revision {db_rev!r}.",
                    "panel": "migrations",
                }
            )
        else:
            migration_status = "ERROR"
            error.append(
                {
                    "code": "ALEMBIC_REVISION_MISMATCH",
                    "message": f"Database revision {db_rev!r} is not the current script head {script_heads[0]!r}.",
                    "panel": "migrations",
                }
            )
    else:
        ok.append(
            {
                "code": "ALEMBIC_IN_SYNC",
                "message": f"Alembic revision matches script head ({db_rev}).",
                "panel": "migrations",
            }
        )

    _startup_snapshot = get_startup_snapshot()
    _mig_snap = _startup_snapshot.migration_integrity
    migrations_panel: dict[str, Any] = {
        "status": migration_status,
        "database_revision": db_rev,
        "script_heads": list(script_heads),
        "in_sync": bool(db_rev and script_heads and len(script_heads) == 1 and db_rev == script_heads[0]),
        "migration_integrity": _mig_snap.as_dict() if _mig_snap is not None else None,
    }

    # --- Stream / validation schedulers (supervisor or external container) ---
    startup = _startup_snapshot
    in_process_scheduler = bool(settings.GDC_ENABLE_IN_PROCESS_SCHEDULER)
    uptime_sec = scheduler_runtime_state.scheduler_uptime_seconds(now=now)
    workers = scheduler_runtime_state.active_worker_count()
    stream_scheduler_running = uptime_sec is not None
    # In-process mode uses the lifespan startup gate. External mode uses live DB/schema
    # readiness so API workers do not depend on process-local scheduler supervisor state.
    if in_process_scheduler:
        scheduler_expected = bool(startup.scheduler_active)
    else:
        scheduler_expected = bool(db_reachable and schema_ok_live)
    external_probe: dict[str, Any] | None = None

    sched_status: Literal["OK", "WARN", "ERROR"] = "OK"
    if not db_reachable:
        sched_status = "ERROR"
    elif in_process_scheduler:
        if scheduler_expected and not stream_scheduler_running:
            sched_status = "ERROR"
            error.append(
                {
                    "code": "STREAM_SCHEDULER_NOT_RUNNING",
                    "message": "Stream scheduler supervisor has not started in this process despite a ready database.",
                    "panel": "scheduler",
                }
            )
        elif scheduler_expected and workers == 0:
            from app.streams.repository import get_enabled_stream_ids

            try:
                enabled_n = len(get_enabled_stream_ids(db))
            except Exception:
                enabled_n = 0
            if enabled_n > 0:
                sched_status = "WARN"
                warn.append(
                    {
                        "code": "STREAM_SCHEDULER_NO_WORKERS",
                        "message": f"Scheduler is up but reports 0 active workers while {enabled_n} stream(s) are enabled.",
                        "panel": "scheduler",
                    }
                )
        elif stream_scheduler_running:
            ok.append(
                {
                    "code": "STREAM_SCHEDULER_UP",
                    "message": "Stream scheduler supervisor has started.",
                    "panel": "scheduler",
                }
            )
        elif not scheduler_expected:
            warn.append(
                {
                    "code": "STREAM_SCHEDULER_GATED",
                    "message": "Stream scheduler did not start because startup reported the database/schema as not ready.",
                    "panel": "scheduler",
                }
            )
            sched_status = "WARN"
    else:
        # Dedicated scheduler container: never treat missing process-local supervisor as failure.
        from app.scheduler.external_container_health import probe_external_scheduler_container

        probe = probe_external_scheduler_container()
        external_probe = probe.as_dict()
        if not scheduler_expected:
            sched_status = "WARN"
            warn.append(
                {
                    "code": "STREAM_SCHEDULER_GATED",
                    "message": "Stream scheduler is gated because startup reported the database/schema as not ready.",
                    "panel": "scheduler",
                }
            )
        elif probe.health_status == "healthy":
            ok.append(
                {
                    "code": "STREAM_SCHEDULER_EXTERNAL_HEALTHY",
                    "message": f"External scheduler container '{probe.container_name}' is healthy.",
                    "panel": "scheduler",
                }
            )
        elif probe.health_status == "unhealthy":
            sched_status = "ERROR"
            error.append(
                {
                    "code": "STREAM_SCHEDULER_EXTERNAL_UNHEALTHY",
                    "message": (
                        probe.detail
                        or f"External scheduler container '{probe.container_name}' is unhealthy."
                    ),
                    "panel": "scheduler",
                }
            )
        elif probe.health_status == "starting":
            sched_status = "WARN"
            warn.append(
                {
                    "code": "STREAM_SCHEDULER_EXTERNAL_STARTING",
                    "message": f"External scheduler container '{probe.container_name}' healthcheck is still starting.",
                    "panel": "scheduler",
                }
            )
        else:
            # unknown / none — do not claim healthy
            sched_status = "WARN"
            warn.append(
                {
                    "code": "STREAM_SCHEDULER_EXTERNAL_UNKNOWN",
                    "message": (
                        probe.detail
                        or f"External scheduler container '{probe.container_name}' health could not be confirmed "
                        f"(status={probe.health_status})."
                    ),
                    "panel": "scheduler",
                }
            )

    backoff_streams: list[dict[str, Any]] = []
    if in_process_scheduler:
        backoff = scheduler_runtime_state.stream_backoff_summary()
        backoff_streams = (
            [
                {
                    "stream_id": int(sid),
                    "consecutive_failures": int(info.get("consecutive_failures") or 0),
                    "wait_sec": float(info.get("wait_sec") or 0),
                    "last_error": info.get("last_error"),
                }
                for sid, info in sorted(backoff.items(), key=lambda item: int(item[0]))
                if isinstance(info, dict)
            ]
            if isinstance(backoff, dict)
            else []
        )
        if backoff_streams and sched_status == "OK":
            sched_status = "WARN"
            warn.append(
                {
                    "code": "STREAM_SCHEDULER_BACKOFF",
                    "message": (
                        f"{len(backoff_streams)} stream worker(s) in transient-error backoff "
                        "(see scheduler.stream_backoff)."
                    ),
                    "panel": "scheduler",
                }
            )

    scheduler_panel: dict[str, Any] = {
        "status": sched_status,
        "mode": "in_process" if in_process_scheduler else "external_container",
        "startup_scheduler_active_gate": scheduler_expected,
        "supervisor_uptime_seconds": uptime_sec if in_process_scheduler else None,
        "active_worker_count": workers if in_process_scheduler else None,
        "stream_backoff": backoff_streams,
        "streams_in_backoff": len(backoff_streams),
        "external_container": external_probe,
    }

    # --- Lab resource budget (dev-validation only; never pauses core streams) ---
    lab_budget_panel: dict[str, Any] = {
        "status": "OK",
        "resource_guardrail_enabled": False,
        "resource_budget_status": "ok",
        "lab_paused": False,
        "lab_pause_reason": None,
        "should_pause_lab": False,
        "exceeded_reasons": [],
        "next_retry_after": None,
        "recommended_action": "none",
    }
    try:
        from app.dev_validation_lab.lab_resource_guardrail import (
            check_lab_resource_budget,
            lab_pause_snapshot,
            lab_resource_guardrail_enabled,
        )
        from app.dev_validation_lab.seeder import lab_effective

        lab_budget_panel["resource_guardrail_enabled"] = bool(lab_resource_guardrail_enabled())
        if lab_effective() and db_reachable:
            budget = check_lab_resource_budget(db, force=False, attempt_wiremock_reset=False)
            from app.dev_validation_lab.lab_auto_remediation import auto_remediation_snapshot

            rem = auto_remediation_snapshot()
            lab_budget_panel.update(
                {
                    "resource_budget_status": str(budget.get("status") or "ok"),
                    "lab_paused": bool(budget.get("lab_paused")),
                    "lab_pause_reason": budget.get("lab_pause_reason"),
                    "should_pause_lab": bool(budget.get("should_pause_lab")),
                    "exceeded_reasons": list(budget.get("exceeded_reasons") or []),
                    "next_retry_after": budget.get("next_retry_after"),
                    "recommended_action": budget.get("recommended_action"),
                    "recent_eps": budget.get("recent_eps"),
                    "delivery_logs_rows": budget.get("delivery_logs_rows"),
                    "delivery_logs_rows_last_10m": budget.get("delivery_logs_rows_last_10m"),
                    "delivery_logs_estimated_size": budget.get("delivery_logs_estimated_size"),
                    "auto_remediation_enabled": bool(
                        budget.get("auto_remediation_enabled", rem.get("auto_remediation_enabled"))
                    ),
                    "auto_cleanup_enabled": bool(
                        budget.get("auto_cleanup_enabled", rem.get("auto_cleanup_enabled"))
                    ),
                    "auto_cleanup_last_run_at": budget.get("auto_cleanup_last_run_at")
                    or rem.get("auto_cleanup_last_run_at"),
                    "auto_cleanup_recovered_budget": bool(
                        budget.get("auto_cleanup_recovered_budget", rem.get("auto_cleanup_recovered_budget"))
                    ),
                    "auto_cleanup_deleted_rows": budget.get("auto_cleanup_deleted_rows")
                    if budget.get("auto_cleanup_deleted_rows") is not None
                    else rem.get("auto_cleanup_deleted_rows"),
                    "destructive_cleanup_required": bool(
                        budget.get("destructive_cleanup_required", rem.get("destructive_cleanup_required"))
                    ),
                    "partition_drop_candidates": list(
                        budget.get("partition_drop_candidates")
                        or rem.get("partition_drop_candidates")
                        or []
                    ),
                }
            )
            if budget.get("auto_cleanup_recovered_budget"):
                ok.append(
                    {
                        "code": "LAB_AUTO_REMEDIATION_OK",
                        "message": "Lab auto remediation recovered budget; lab generation may continue.",
                        "panel": "lab_resource_budget",
                    }
                )
            if budget.get("destructive_cleanup_required"):
                lab_budget_panel["status"] = "WARN"
                rows = budget.get("delivery_logs_rows")
                size = budget.get("delivery_logs_estimated_size")
                limits = (budget.get("limits") or {}) if isinstance(budget.get("limits"), dict) else {}
                max_rows = limits.get("max_delivery_log_rows") or getattr(
                    __import__("app.config", fromlist=["settings"]).settings,
                    "GDC_LAB_MAX_DELIVERY_LOG_ROWS",
                    500_000,
                )
                max_size = limits.get("max_delivery_log_size_bytes") or getattr(
                    __import__("app.config", fromlist=["settings"]).settings,
                    "GDC_LAB_MAX_DELIVERY_LOG_SIZE_BYTES",
                    2_147_483_648,
                )
                cand_n = len(
                    [
                        c
                        for c in (budget.get("partition_drop_candidates") or [])
                        if isinstance(c, dict) and c.get("safe_to_drop_candidate")
                    ]
                )
                action = budget.get("recommended_action") or (
                    "Automatic cleanup cannot safely recover this state. "
                    "Manual review is required for old delivery_logs partitions."
                )
                warn.append(
                    {
                        "code": "LAB_DESTRUCTIVE_CLEANUP_REQUIRED",
                        "message": (
                            "Safe auto cleanup insufficient for delivery_logs. "
                            f"rows={rows} limit_rows={max_rows} size={size} limit_size={max_size} "
                            f"safe_partition_candidates={cand_n}. "
                            f"Next: {action}"
                        ),
                        "panel": "lab_resource_budget",
                    }
                )
            if budget.get("should_pause_lab") or budget.get("lab_paused"):
                lab_budget_panel["status"] = "WARN"
                reason = budget.get("lab_pause_reason") or "budget_exceeded"
                code = (
                    "LAB_GENERATION_PAUSED_AFTER_REMEDIATION_FAILED"
                    if reason
                    in {"cleanup_failed", "cleanup_insufficient", "destructive_cleanup_required"}
                    else "LAB_RESOURCE_BUDGET_PAUSED"
                )
                action = budget.get("recommended_action") or ""
                warn.append(
                    {
                        "code": code,
                        "message": (
                            f"Lab/E2E generation paused: {reason}. "
                            "Core platform streams continue. "
                            f"{action}".strip()
                        ),
                        "panel": "lab_resource_budget",
                    }
                )
            elif (
                budget.get("auto_remediation")
                and budget["auto_remediation"].get("attempted")
                and budget["auto_remediation"].get("errors")
            ):
                lab_budget_panel["status"] = "WARN"
                warn.append(
                    {
                        "code": "LAB_AUTO_REMEDIATION_FAILED",
                        "message": "Lab auto remediation reported errors; see auto_cleanup_last_result.",
                        "panel": "lab_resource_budget",
                    }
                )
            elif str(budget.get("status") or "") == "warning":
                lab_budget_panel["status"] = "WARN"
        else:
            pause = lab_pause_snapshot()
            lab_budget_panel["lab_paused"] = bool(pause.get("lab_paused"))
            lab_budget_panel["lab_pause_reason"] = pause.get("lab_pause_reason")
            lab_budget_panel["next_retry_after"] = pause.get("next_retry_after")
    except Exception as exc:
        lab_budget_panel["status"] = "WARN"
        lab_budget_panel["detail"] = f"{type(exc).__name__}: {str(exc)[:160]}"


    # --- Retention cleanup ---
    ret_row = get_retention_policy_row(db) if db_reachable else None
    cleanup_sched = get_cleanup_scheduler()
    cleanup_thread_alive = bool(cleanup_sched and cleanup_sched.is_running())
    cleanup_enabled = bool(getattr(ret_row, "cleanup_scheduler_enabled", False)) if ret_row is not None else False
    interval_min = int(getattr(ret_row, "cleanup_interval_minutes", 60) or 60) if ret_row is not None else 60
    last_tick = cleanup_sched.last_tick_at() if cleanup_sched else None

    ret_status: Literal["OK", "WARN", "ERROR"] = "OK"
    if not db_reachable:
        ret_status = "ERROR"
    elif not cleanup_enabled:
        warn.append(
            {
                "code": "RETENTION_CLEANUP_SCHEDULER_DISABLED",
                "message": "Retention cleanup scheduler is disabled in policy — old logs/metrics may accumulate.",
                "panel": "retention",
            }
        )
        ret_status = "WARN"
    elif cleanup_enabled and not cleanup_thread_alive:
        warn.append(
            {
                "code": "RETENTION_CLEANUP_THREAD_DOWN",
                "message": "Retention cleanup is enabled but the background thread is not running in this process.",
                "panel": "retention",
            }
        )
        ret_status = "WARN"
    elif last_tick is not None:
        age = (now - last_tick.astimezone(timezone.utc)).total_seconds()
        stale_sec = max(300.0, float(interval_min) * 180.0)
        if age > stale_sec:
            warn.append(
                {
                    "code": "RETENTION_CLEANUP_TICK_STALE",
                    "message": f"Last retention scheduler tick was {int(age)}s ago (threshold {int(stale_sec)}s).",
                    "panel": "retention",
                }
            )
            ret_status = "WARN"
    if db_reachable and ret_status == "OK" and cleanup_enabled and cleanup_thread_alive:
        ok.append(
            {
                "code": "RETENTION_ENGINE_ACTIVE",
                "message": "Retention cleanup scheduler is enabled and the thread is running.",
                "panel": "retention",
            }
        )

    def _ret_block(cat: str) -> dict[str, Any]:
        if ret_row is None:
            return {}
        return {
            "enabled": bool(getattr(ret_row, f"{cat}_enabled")),
            "retention_days": int(getattr(ret_row, f"{cat}_retention_days")),
            "last_cleanup_at": getattr(ret_row, f"{cat}_last_cleanup_at"),
            "next_cleanup_at": getattr(ret_row, f"{cat}_next_cleanup_at"),
            "last_status": getattr(ret_row, f"{cat}_last_status", None),
        }

    retention_panel: dict[str, Any] = {
        "status": ret_status,
        "cleanup_scheduler_enabled": cleanup_enabled,
        "cleanup_thread_running": cleanup_thread_alive,
        "cleanup_interval_minutes": interval_min,
        "scheduler_last_tick_at": last_tick,
        "categories": {
            "logs": _ret_block("logs"),
            "runtime_metrics": _ret_block("runtime_metrics"),
            "preview_cache": _ret_block("preview_cache"),
            "backup_temp": _ret_block("backup_temp"),
        },
    }

    # --- delivery_logs partitions ---
    partitions_status: Literal["OK", "WARN", "ERROR"] = "OK"
    partitions_panel: dict[str, Any] = {
        "status": "OK",
        "partitioned": False,
        "partition_key": None,
        "partition_count": 0,
        "oldest_partition": None,
        "newest_partition": None,
        "orphan_partitions": [],
        "protected_months": [],
        "maintenance_scheduler_running": False,
        "last_maintenance": {},
    }
    if db_reachable:
        try:
            pol_row = get_retention_policy_row(db)
            pol = effective_retention_policies(pol_row)
            part_sched = get_partition_maintenance_scheduler()
            last_maint: dict[str, Any] = {}
            if part_sched is not None:
                partitions_panel["maintenance_scheduler_running"] = part_sched.is_running()
                lr = part_sched.last_result()
                if lr is not None:
                    last_maint = {
                        "status": lr.status,
                        "message": lr.message,
                        "ensured_partitions": list(lr.ensured_partitions),
                        "orphan_partitions": list(lr.orphan_partitions),
                    }
                if part_sched.last_tick_at() is not None:
                    last_maint["last_tick_at"] = part_sched.last_tick_at().isoformat()
            snap = build_partition_observability(
                db,
                retention_days=pol["delivery_logs_days"],
                checkpoint_history_retention_days=pol.get("checkpoint_history_days", pol["delivery_logs_days"]),
                last_maintenance=last_maint,
            )
            partitions_panel.update(
                {
                    "partitioned": snap.delivery_logs_partitioned,
                    "partition_key": snap.partition_key,
                    "partition_count": len([p for p in snap.partitions if not p.is_default]),
                    "oldest_partition": snap.oldest_partition,
                    "newest_partition": snap.newest_partition,
                    "orphan_partitions": list(snap.orphan_partitions),
                    "protected_months": list(snap.protected_months),
                    "retention_days": snap.retention_days,
                    "checkpoint_history_retention_days": snap.checkpoint_history_retention_days,
                    "last_maintenance": last_maint,
                }
            )
            if not snap.delivery_logs_partitioned:
                partitions_status = "WARN"
                warn.append(
                    {
                        "code": "DELIVERY_LOGS_NOT_PARTITIONED",
                        "message": "delivery_logs is not range-partitioned; apply migration 20260517_0021.",
                        "panel": "partitions",
                    }
                )
            elif snap.orphan_partitions:
                partitions_status = "WARN"
                warn.append(
                    {
                        "code": "DELIVERY_LOGS_ORPHAN_PARTITIONS",
                        "message": f"Non-canonical child partitions detected: {', '.join(snap.orphan_partitions)}",
                        "panel": "partitions",
                    }
                )
            else:
                ok.append(
                    {
                        "code": "DELIVERY_LOGS_PARTITIONS_OK",
                        "message": "delivery_logs monthly partitions are present with no orphan children.",
                        "panel": "partitions",
                    }
                )
        except Exception as exc:
            partitions_status = "WARN"
            partitions_panel["error"] = str(exc)[:200]
            warn.append(
                {
                    "code": "PARTITION_PANEL_FAILED",
                    "message": f"Partition observability probe failed: {str(exc)[:200]}",
                    "panel": "partitions",
                }
            )
    partitions_panel["status"] = partitions_status

    # --- Storage ---
    disk = _disk_summary()
    storage_status: Literal["OK", "WARN", "ERROR"] = "OK"
    used_pct = disk.get("used_percent")
    if used_pct is not None:
        if used_pct >= 95:
            storage_status = "ERROR"
            error.append(
                {
                    "code": "DISK_CRITICAL",
                    "message": f"Disk used {used_pct}% on {disk.get('path', '/')}.",
                    "panel": "storage",
                }
            )
        elif used_pct >= 85:
            storage_status = "WARN"
            warn.append(
                {
                    "code": "DISK_PRESSURE",
                    "message": f"Disk used {used_pct}% on {disk.get('path', '/')}.",
                    "panel": "storage",
                }
            )
    elif disk.get("error"):
        storage_status = "WARN"
        warn.append({"code": "DISK_PROBE_FAILED", "message": str(disk["error"]), "panel": "storage"})

    storage_panel: dict[str, Any] = {"status": storage_status, "disk": disk}

    # --- Destination health (1h) ---
    since = now - _WINDOW
    dest_rows = (
        fetch_destination_health_aggregates(db, since=since, until=now, stream_id=None, route_id=None, destination_id=None)
        if db_reachable
        else []
    )
    dest_lookup = fetch_destination_lookup(db, [int(r.group_id) for r in dest_rows if r.group_id is not None])
    dest_summaries: list[dict[str, Any]] = []
    dest_panel_status: Literal["OK", "WARN", "ERROR"] = "OK"
    for r in dest_rows:
        d = normalize_aggregate_row(r)
        gid = d["group_id"]
        if gid is None:
            continue
        fails = int(d["failure_count"])
        succ = int(d["success_count"])
        tot = fails + succ
        rate = (fails / tot) if tot > 0 else None
        name, _dtype = dest_lookup.get(gid, (None, None))
        spike = fails >= 10 or (fails >= 3 and fails > succ and tot >= 3)
        if spike:
            dest_panel_status = "WARN"
            warn.append(
                {
                    "code": "DESTINATION_FAILURE_SPIKE",
                    "message": f"Destination #{gid} ({name or 'unnamed'}) shows elevated failures in the last hour.",
                    "panel": "destinations",
                }
            )
        dest_summaries.append(
            {
                "destination_id": gid,
                "destination_name": name,
                "failure_count_1h": fails,
                "success_count_1h": succ,
                "failure_rate_1h": round(rate, 4) if rate is not None else None,
                "last_failure_at": d["last_failure_at"].isoformat() if d.get("last_failure_at") else None,
            }
        )

    destinations_panel: dict[str, Any] = {
        "status": dest_panel_status,
        "window_hours": 1,
        "destinations": sorted(dest_summaries, key=lambda x: int(x.get("failure_count_1h") or 0), reverse=True)[:24],
    }

    # --- TLS certificate ---
    https_row = get_https_config_row(db) if db_reachable else None
    cert_path = Path(settings.GDC_TLS_CERT_PATH).expanduser()
    if not cert_path.is_absolute():
        cert_path = Path.cwd() / cert_path
    cert_expiry: datetime | None = None
    if https_row is not None and getattr(https_row, "cert_not_after", None):
        cert_expiry = https_row.cert_not_after
    elif cert_path.is_file():
        try:
            cert_expiry = read_certificate_not_after_pem(cert_path)
        except Exception:
            cert_expiry = None

    cert_status: Literal["OK", "WARN", "ERROR"] = "OK"
    days_left: float | None = None
    https_on = bool(https_row and https_row.enabled)
    if https_on and cert_expiry is not None:
        delta = cert_expiry.astimezone(timezone.utc) - now
        days_left = delta.total_seconds() / 86400.0
        if days_left <= 7:
            cert_status = "ERROR"
            error.append(
                {
                    "code": "TLS_CERT_EXPIRES_WITHIN_7D",
                    "message": f"HTTPS certificate expires in {max(0.0, days_left):.1f} days.",
                    "panel": "certificates",
                }
            )
        elif days_left <= 30:
            cert_status = "WARN"
            warn.append(
                {
                    "code": "TLS_CERT_EXPIRES_WITHIN_30D",
                    "message": f"HTTPS certificate expires in {days_left:.1f} days.",
                    "panel": "certificates",
                }
            )
    elif https_on and cert_expiry is None:
        cert_status = "WARN"
        warn.append(
            {
                "code": "TLS_CERT_EXPIRY_UNKNOWN",
                "message": "HTTPS is enabled but certificate expiry could not be read.",
                "panel": "certificates",
            }
        )

    certificates_panel: dict[str, Any] = {
        "status": cert_status,
        "https_enabled": https_on,
        "certificate_not_after": cert_expiry,
        "days_remaining": round(days_left, 2) if days_left is not None else None,
        "cert_path": str(cert_path) if https_on else None,
    }

    # --- Recent critical delivery failures ---
    recent: list[dict[str, Any]] = []
    if db_reachable:
        rows = (
            db.query(DeliveryLog)
            .filter(DeliveryLog.stage.in_(_FAIL_STAGES))
            .order_by(DeliveryLog.created_at.desc())
            .limit(25)
            .all()
        )
        for row in rows:
            raw_msg = str(row.message or "")
            msg = _safe_failure_message(str(_safe_text(raw_msg) or ""))
            pl = row.payload_sample or {}
            masked_pl = mask_secrets_and_pem(pl) if isinstance(pl, dict) else {}
            recent.append(
                {
                    "id": int(row.id),
                    "created_at": row.created_at,
                    "stream_id": row.stream_id,
                    "route_id": row.route_id,
                    "destination_id": row.destination_id,
                    "stage": row.stage,
                    "error_code": row.error_code,
                    "http_status": row.http_status,
                    "message": msg,
                    "payload_sample_masked": masked_pl,
                }
            )

    failures_panel: dict[str, Any] = {
        "status": "WARN" if recent else "OK",
        "count_returned": len(recent),
        "items": recent,
    }
    if recent:
        warn.append(
            {
                "code": "RECENT_DELIVERY_FAILURES_PRESENT",
                "message": f"{len(recent)} recent failure log row(s) returned (sample capped).",
                "panel": "recent_failures",
            }
        )

    # --- delivery_logs index catalog (invalid / not-ready) ---
    idx_panel: dict[str, Any] = {
        "status": "OK",
        "checked": False,
        "invalid_indexes": [],
        "reindex_suggested": False,
        "error": None,
        "reindex_hint": "REINDEX INDEX CONCURRENTLY <index_name>; — or REINDEX TABLE CONCURRENTLY delivery_logs;",
    }
    idx_status: Literal["OK", "WARN", "ERROR"] = "OK"
    if db_reachable:
        try:
            probe = probe_delivery_logs_indexes(db.connection())
            idx_panel["checked"] = bool(probe.get("checked"))
            idx_panel["invalid_indexes"] = list(probe.get("invalid_indexes") or [])
            idx_panel["reindex_suggested"] = bool(probe.get("reindex_suggested"))
            idx_panel["error"] = probe.get("error")
            if probe.get("error"):
                idx_status = "WARN"
                warn.append(
                    {
                        "code": "DELIVERY_LOGS_INDEX_PROBE_FAILED",
                        "message": f"Could not read pg_index for delivery_logs: {probe['error']}",
                        "panel": "delivery_logs_indexes",
                    }
                )
            elif probe.get("reindex_suggested"):
                idx_status = "ERROR"
                names = ", ".join(str(x.get("name") or "?") for x in idx_panel["invalid_indexes"])
                error.append(
                    {
                        "code": "DELIVERY_LOGS_INDEX_INVALID",
                        "message": (
                            f"One or more delivery_logs indexes are invalid or not ready: {names}. "
                            "Plan a maintenance window for REINDEX (prefer CONCURRENTLY on supported versions)."
                        ),
                        "panel": "delivery_logs_indexes",
                    }
                )
            else:
                ok.append(
                    {
                        "code": "DELIVERY_LOGS_INDEXES_VALID",
                        "message": "delivery_logs btree indexes report valid and ready in pg_index.",
                        "panel": "delivery_logs_indexes",
                    }
                )
        except Exception as exc:
            idx_status = "WARN"
            idx_panel["error"] = str(exc)[:200]
            warn.append(
                {
                    "code": "DELIVERY_LOGS_INDEX_PROBE_EXCEPTION",
                    "message": f"delivery_logs index probe failed: {str(exc)[:200]}",
                    "panel": "delivery_logs_indexes",
                }
            )
    else:
        idx_status = "WARN"
        warn.append(
            {
                "code": "DELIVERY_LOGS_INDEX_SKIPPED_DB_DOWN",
                "message": "Skipped delivery_logs index catalog check because the database probe failed.",
                "panel": "delivery_logs_indexes",
            }
        )
    idx_panel["status"] = idx_status

    # --- pg_stat_statements (operator SQL performance) ---
    pgss_panel: dict[str, Any] = {
        "status": "OK",
        "checked": False,
        "enabled": False,
        "extension_installed": False,
        "tracked_statements": 0,
        "top_queries": [],
        "error": None,
    }
    pgss_status: Literal["OK", "WARN", "ERROR"] = "OK"
    if db_reachable:
        try:
            probe = probe_pg_stat_statements(db.connection())
            pgss_panel["checked"] = True
            pgss_panel["enabled"] = bool(probe.get("enabled"))
            pgss_panel["extension_installed"] = bool(probe.get("extension_installed"))
            pgss_panel["tracked_statements"] = int(probe.get("tracked_statements") or 0)
            pgss_panel["error"] = probe.get("error")
            if probe.get("extension_installed"):
                pgss_panel["top_queries"] = fetch_pg_stat_statements_top(db.connection(), limit=10)
            elif not probe.get("enabled"):
                pgss_status = "WARN"
                warn.append(
                    {
                        "code": "PG_STAT_STATEMENTS_NOT_PRELOADED",
                        "message": (
                            "pg_stat_statements is not in shared_preload_libraries; "
                            "restart PostgreSQL with shared_preload_libraries=pg_stat_statements."
                        ),
                        "panel": "pg_stat_statements",
                    }
                )
            elif not probe.get("extension_installed"):
                pgss_status = "WARN"
                warn.append(
                    {
                        "code": "PG_STAT_STATEMENTS_EXTENSION_MISSING",
                        "message": "Run migration to CREATE EXTENSION pg_stat_statements.",
                        "panel": "pg_stat_statements",
                    }
                )
        except Exception as exc:  # pragma: no cover - defensive
            pgss_status = "WARN"
            pgss_panel["error"] = str(exc)[:200]
            warn.append(
                {
                    "code": "PG_STAT_STATEMENTS_PROBE_FAILED",
                    "message": f"pg_stat_statements probe failed: {str(exc)[:200]}",
                    "panel": "pg_stat_statements",
                }
            )
    else:
        pgss_status = "WARN"
    pgss_panel["status"] = pgss_status

    # --- Support bundle shortcut ---
    support_panel: dict[str, Any] = {
        "status": "OK",
        "download_method": "GET",
        "download_path": "/api/v1/admin/support-bundle",
        "notes": "Administrator-only; ZIP contents are masked server-side.",
    }

    # Roll up overall
    panel_statuses = [
        database_panel["status"],
        migrations_panel["status"],
        scheduler_panel["status"],
        lab_budget_panel["status"],
        retention_panel["status"],
        partitions_panel["status"],
        storage_panel["status"],
        destinations_panel["status"],
        certificates_panel["status"],
        failures_panel["status"],
        idx_panel["status"],
        pgss_panel["status"],
        support_panel["status"],
    ]
    overall: Literal["OK", "WARN", "ERROR"] = "OK"
    if error or any(x == "ERROR" for x in panel_statuses):
        overall = "ERROR"
    elif warn or any(x == "WARN" for x in panel_statuses):
        overall = "WARN"

    return {
        "generated_at": now,
        "overall": overall,
        "ok": ok,
        "warn": warn,
        "error": error,
        "panels": {
            "database": database_panel,
            "migrations": migrations_panel,
            "scheduler": scheduler_panel,
            "lab_resource_budget": lab_budget_panel,
            "retention": retention_panel,
            "partitions": partitions_panel,
            "storage": storage_panel,
            "destinations": destinations_panel,
            "certificates": certificates_panel,
            "recent_failures": failures_panel,
            "delivery_logs_indexes": idx_panel,
            "pg_stat_statements": pgss_panel,
            "support_bundle": support_panel,
        },
    }


__all__ = ["build_maintenance_health"]
