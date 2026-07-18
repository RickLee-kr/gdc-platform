"""Lab cleanup recoverability assessment (advisory only; never executes DROP).

Distinguishes states that auto row-delete can fix from states that need
manual partition DROP review. Production and lab never auto-run destructive DDL.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.db.delivery_log_partitions import (
    add_month,
    list_delivery_log_monthly_partitions,
    month_floor,
    protected_partition_months,
    quote_delivery_log_partition_ident,
)

UTC = timezone.utc

RECOVERABLE_BY_AUTO_CLEANUP = "recoverable_by_auto_cleanup"
NEEDS_MULTIPLE_AUTO_CLEANUP_CYCLES = "needs_multiple_auto_cleanup_cycles"
DESTRUCTIVE_CLEANUP_RECOMMENDED = "destructive_cleanup_recommended"
DESTRUCTIVE_CLEANUP_REQUIRED = "destructive_cleanup_required"
WITHIN_BUDGET = "within_budget"
UNKNOWN = "unknown"


def _as_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def enrich_partition_drop_candidates(
    db: Session | None,
    *,
    retention_days: int,
    now: datetime | None = None,
    cheap: bool = True,
) -> list[dict[str, Any]]:
    """Build detailed partition candidate rows for status/diagnostics/CLI.

    Includes protected (current/next month) partitions as ``safe_to_drop_candidate=false``
    and retention-eligible months as ``safe_to_drop_candidate=true``.
    Never drops anything.
    """

    if db is None:
        return []

    ref = now or datetime.now(UTC)
    if ref.tzinfo is None:
        ref = ref.replace(tzinfo=UTC)
    cutoff = ref - timedelta(days=max(1, int(retention_days)))
    cutoff_month = month_floor(cutoff)
    protected = protected_partition_months(ref)
    out: list[dict[str, Any]] = []

    try:
        partitions = list_delivery_log_monthly_partitions(db)
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        return []

    for name, month_start in partitions:
        month_end = add_month(month_start)
        is_protected = month_start in protected
        fully_before_cutoff = month_end <= cutoff_month
        safe = (not is_protected) and fully_before_cutoff

        estimated_rows: int | None = None
        estimated_size: int | None = None
        min_created: str | None = None
        max_created: str | None = None
        try:
            quoted = quote_delivery_log_partition_ident(name)
            size_val = db.execute(text(f"SELECT pg_total_relation_size('{name}'::regclass)")).scalar()
            estimated_size = int(size_val) if size_val is not None else None
            if cheap:
                est = db.execute(
                    text("SELECT GREATEST(reltuples::bigint, 0) FROM pg_class WHERE oid = :rel::regclass"),
                    {"rel": name},
                ).scalar()
                estimated_rows = int(est) if est is not None else None
            else:
                cnt = db.execute(text(f"SELECT count(*) FROM {quoted}")).scalar()
                estimated_rows = int(cnt) if cnt is not None else None
            # Date range from partition bounds (exact for monthly partitions).
            min_created = f"{month_start.isoformat()}T00:00:00+00:00"
            max_created = f"{(month_end - timedelta(days=1)).isoformat()}T23:59:59+00:00"
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass

        if is_protected:
            reason = "current_or_next_month_protected"
        elif not fully_before_cutoff:
            reason = "partition_may_contain_rows_newer_than_retention_cutoff"
        else:
            reason = "fully_older_than_retention_cutoff_safe_drop_candidate"

        out.append(
            {
                "partition_name": name,
                "estimated_size_bytes": estimated_size,
                "estimated_rows": estimated_rows,
                "min_created_at": min_created,
                "max_created_at": max_created,
                "month_start": month_start.isoformat(),
                "month_end": month_end.isoformat(),
                "retention_cutoff": cutoff.isoformat(),
                "safe_to_drop_candidate": safe,
                "reason": reason,
            }
        )
    return out


def _format_bytes_human(n: int | None) -> str:
    if n is None:
        return "unknown"
    value = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024.0 or unit == "TB":
            if unit == "B":
                return f"{int(value)} {unit}"
            return f"{value:.1f} {unit}"
        value /= 1024.0
    return f"{n} B"


def _date_range_label(candidate: dict[str, Any]) -> str:
    month_start = candidate.get("month_start")
    month_end = candidate.get("month_end")
    if month_start and month_end:
        try:
            end = date.fromisoformat(str(month_end)) - timedelta(days=1)
            return f"{month_start} ~ {end.isoformat()}"
        except ValueError:
            pass
    min_c = str(candidate.get("min_created_at") or "")[:10]
    max_c = str(candidate.get("max_created_at") or "")[:10]
    if min_c and max_c:
        return f"{min_c} ~ {max_c}"
    return "unknown"


def _drop_reason_label(candidate: dict[str, Any]) -> str:
    reason = str(candidate.get("reason") or "")
    if reason in {
        "fully_older_than_retention_cutoff_safe_drop_candidate",
        "partition is fully outside retention cutoff",
    }:
        return "partition is fully outside retention cutoff"
    return reason or "safe_to_drop_candidate"


def build_partition_drop_sql(candidates: list[dict[str, Any]]) -> list[str]:
    """Return commented DROP TABLE blocks for safe_to_drop_candidate=true only (never execute).

    Current/next-month and other non-safe partitions are omitted.
    """

    sqls: list[str] = []
    for c in candidates:
        if not c.get("safe_to_drop_candidate"):
            continue
        name = str(c.get("partition_name") or "")
        if not name:
            continue
        try:
            quoted = quote_delivery_log_partition_ident(name)
        except ValueError:
            continue
        rows = c.get("estimated_rows")
        rows_label = "unknown" if rows is None else str(int(rows))
        block = "\n".join(
            [
                f"-- Candidate: {name}",
                f"-- Estimated size: {_format_bytes_human(_as_int(c.get('estimated_size_bytes')))}",
                f"-- Estimated rows: {rows_label}",
                f"-- Date range: {_date_range_label(c)}",
                f"-- Reason: {_drop_reason_label(c)}",
                f"DROP TABLE IF EXISTS {quoted};",
            ]
        )
        sqls.append(block)
    return sqls


def should_pause_lab_for_recoverability(
    recoverability_status: str | None,
    *,
    remediation_errors: list[str] | None = None,
    remediation_recovered: bool = False,
) -> tuple[bool, str | None]:
    """Fixed pause policy for lab/e2e generation (never pauses core scheduler tasks).

    Policy:
    - recoverable_by_auto_cleanup → pause=false
    - needs_multiple_auto_cleanup_cycles → pause=false
    - destructive_cleanup_recommended → pause=false (advisory only)
    - destructive_cleanup_required → pause=true
    - cleanup_failed (errors + unrecovered) → pause=true
    - cleanup_insufficient (still over, not auto-recoverable) → pause=true
    """

    if remediation_recovered:
        return False, None
    if remediation_errors:
        return True, "cleanup_failed"

    status = str(recoverability_status or "")
    if status == DESTRUCTIVE_CLEANUP_REQUIRED:
        return True, "destructive_cleanup_required"
    if status in {
        RECOVERABLE_BY_AUTO_CLEANUP,
        NEEDS_MULTIPLE_AUTO_CLEANUP_CYCLES,
        DESTRUCTIVE_CLEANUP_RECOMMENDED,
        WITHIN_BUDGET,
    }:
        return False, None
    if status in {UNKNOWN, ""}:
        # Still over budget without a clear auto path.
        return True, "cleanup_insufficient"
    return True, "cleanup_insufficient"


def assess_lab_cleanup_recoverability(
    *,
    budget: dict[str, Any] | None = None,
    delivery_logs_rows: int | None = None,
    delivery_logs_size: int | None = None,
    delivery_logs_eligible_rows: int | None = None,
    max_delivery_log_rows: int | None = None,
    max_delivery_log_size_bytes: int | None = None,
    max_rows_per_run: int | None = None,
    partition_candidates: list[dict[str, Any]] | None = None,
    remediation_recovered: bool | None = None,
    remediation_still_exceeded: bool | None = None,
    remediation_errors: list[str] | None = None,
) -> dict[str, Any]:
    """Classify whether auto cleanup can recover delivery_logs budget pressure."""

    b = dict(budget or {})
    limits = dict(b.get("limits") or {})
    rows = _as_int(delivery_logs_rows if delivery_logs_rows is not None else b.get("delivery_logs_rows"))
    size = _as_int(
        delivery_logs_size if delivery_logs_size is not None else b.get("delivery_logs_estimated_size")
    )
    max_rows = _as_int(
        max_delivery_log_rows
        if max_delivery_log_rows is not None
        else limits.get("max_delivery_log_rows")
        or getattr(settings, "GDC_LAB_MAX_DELIVERY_LOG_ROWS", 500_000)
    ) or 500_000
    max_size = _as_int(
        max_delivery_log_size_bytes
        if max_delivery_log_size_bytes is not None
        else limits.get("max_delivery_log_size_bytes")
        or getattr(settings, "GDC_LAB_MAX_DELIVERY_LOG_SIZE_BYTES", 2_147_483_648)
    ) or 2_147_483_648
    per_run = _as_int(
        max_rows_per_run
        if max_rows_per_run is not None
        else getattr(settings, "GDC_LAB_AUTO_CLEANUP_MAX_ROWS_PER_RUN", 100_000)
    ) or 100_000

    exceeded = list(b.get("exceeded_reasons") or [])
    rows_over = rows is not None and rows > max_rows
    size_over = size is not None and size > max_size
    delivery_over = rows_over or size_over or any(
        r.startswith("delivery_logs_rows>") or r.startswith("delivery_logs_size>") for r in exceeded
    )

    candidates = list(partition_candidates or [])
    safe_cands = [c for c in candidates if c.get("safe_to_drop_candidate")]
    safe_rows = sum(int(c.get("estimated_rows") or 0) for c in safe_cands)
    safe_size = sum(int(c.get("estimated_size_bytes") or 0) for c in safe_cands)

    eligible = _as_int(delivery_logs_eligible_rows)
    if eligible is None:
        # Prefer sum of safe partition estimates; else unknown.
        eligible = safe_rows if safe_cands else None

    cycles_estimated: int | None = None
    if eligible is not None and eligible > 0 and per_run > 0:
        cycles_estimated = int(math.ceil(float(eligible) / float(per_run)))

    status = WITHIN_BUDGET
    recommended_parts: list[str] = []

    if remediation_errors and remediation_still_exceeded:
        status = DESTRUCTIVE_CLEANUP_REQUIRED
        recommended_parts.append("Automatic cleanup cannot safely recover this state.")
        recommended_parts.append("Manual review is required for old delivery_logs partitions.")
        recommended_parts.append("Run lab cleanup dry-run before manual cleanup.")
    elif remediation_recovered:
        status = WITHIN_BUDGET
        recommended_parts.append("Auto cleanup recovered budget. Lab generation may continue.")
    elif not delivery_over and not exceeded:
        status = WITHIN_BUDGET
        recommended_parts.append("Budget within limits.")
    else:
        # Estimate rows after deleting eligible retention-aged rows.
        projected_rows = None
        if rows is not None and eligible is not None:
            projected_rows = max(0, rows - eligible)
        projected_size = None
        if size is not None and safe_size > 0:
            # Rough: reclaim safe partition sizes (row delete may not free disk until VACUUM).
            projected_size = max(0, size - safe_size)

        can_meet_row = projected_rows is not None and projected_rows <= max_rows
        # Size often needs DROP or VACUUM to reclaim; if size is over budget and
        # safe old partitions exist with meaningful reclaimable size, recommend DROP.
        significant_partition_reclaim = bool(safe_cands) and safe_size > 0 and (
            size_over or (size is not None and safe_size >= max(1, int(size * 0.25)))
        )
        if size_over and safe_cands and (
            projected_size is None or projected_size > max_size or significant_partition_reclaim
        ):
            if remediation_still_exceeded:
                status = DESTRUCTIVE_CLEANUP_REQUIRED
                recommended_parts.append("Automatic cleanup cannot safely recover this state.")
                recommended_parts.append("Manual review is required for old delivery_logs partitions.")
                recommended_parts.append("Manual partition DROP is recommended for old delivery_logs partitions.")
                recommended_parts.append("Run lab cleanup dry-run before manual cleanup.")
            else:
                status = DESTRUCTIVE_CLEANUP_RECOMMENDED
                recommended_parts.append("Manual partition DROP is recommended for old delivery_logs partitions.")
                recommended_parts.append("Run lab cleanup dry-run before manual cleanup.")
                recommended_parts.append(
                    "Row delete alone may not reclaim disk size without VACUUM/partition DROP."
                )
        elif can_meet_row and eligible is not None and eligible > 0:
            if cycles_estimated is not None and cycles_estimated > 1:
                status = NEEDS_MULTIPLE_AUTO_CLEANUP_CYCLES
                recommended_parts.append("Auto cleanup is running. Wait for next cleanup cycle.")
                recommended_parts.append(
                    f"Current max rows per run is {per_run}. "
                    f"Existing backlog may require about {cycles_estimated} cleanup cycles."
                )
                recommended_parts.append(
                    "Increase GDC_LAB_AUTO_CLEANUP_MAX_ROWS_PER_RUN if DB lock/timeout is acceptable."
                )
                recommended_parts.append(
                    "For lab-only recovery, consider 500000 or 1000000 if DB timeout does not occur."
                )
            else:
                status = RECOVERABLE_BY_AUTO_CLEANUP
                recommended_parts.append("Auto cleanup is running. Wait for next cleanup cycle.")
        elif safe_cands and (rows_over or size_over):
            if remediation_still_exceeded or (projected_rows is not None and projected_rows > max_rows):
                status = DESTRUCTIVE_CLEANUP_REQUIRED
                recommended_parts.append("Automatic cleanup cannot safely recover this state.")
                recommended_parts.append("Manual review is required for old delivery_logs partitions.")
                recommended_parts.append("Manual partition DROP is recommended for old delivery_logs partitions.")
            else:
                status = DESTRUCTIVE_CLEANUP_RECOMMENDED
                recommended_parts.append("Manual partition DROP is recommended for old delivery_logs partitions.")
                recommended_parts.append("Run lab cleanup dry-run before manual cleanup.")
        elif remediation_still_exceeded:
            status = DESTRUCTIVE_CLEANUP_REQUIRED
            recommended_parts.append("Automatic cleanup cannot safely recover this state.")
            recommended_parts.append("Manual review is required for old delivery_logs partitions.")
        elif cycles_estimated is not None and cycles_estimated > 1:
            status = NEEDS_MULTIPLE_AUTO_CLEANUP_CYCLES
            recommended_parts.append("Auto cleanup is running. Wait for next cleanup cycle.")
            recommended_parts.append(
                f"Current max rows per run is {per_run}. "
                f"Existing backlog may require about {cycles_estimated} cleanup cycles."
            )
            recommended_parts.append(
                "Increase GDC_LAB_AUTO_CLEANUP_MAX_ROWS_PER_RUN if DB lock/timeout is acceptable."
            )
        elif delivery_over:
            status = UNKNOWN
            recommended_parts.append("Budget exceeded; inspect diagnostics and lab status.")
        else:
            status = WITHIN_BUDGET
            recommended_parts.append("Budget within limits.")

    recommended_action = " ".join(recommended_parts) if recommended_parts else "none"

    return {
        "recoverability_status": status,
        "auto_cleanup_cycles_estimated": cycles_estimated,
        "destructive_cleanup_required": status == DESTRUCTIVE_CLEANUP_REQUIRED,
        "destructive_cleanup_recommended": status
        in {DESTRUCTIVE_CLEANUP_RECOMMENDED, DESTRUCTIVE_CLEANUP_REQUIRED},
        "partition_drop_candidates_count": len(safe_cands),
        "partition_drop_candidates_all_count": len(candidates),
        "safe_partition_estimated_rows": safe_rows,
        "safe_partition_estimated_size_bytes": safe_size,
        "delivery_logs_eligible_rows": eligible,
        "max_rows_per_run": per_run,
        "max_delivery_log_rows": max_rows,
        "max_delivery_log_size_bytes": max_size,
        "current_delivery_logs_rows": rows,
        "current_delivery_logs_size_bytes": size,
        "recommended_action": recommended_action,
        "partition_drop_candidates": candidates,
    }


__all__ = [
    "DESTRUCTIVE_CLEANUP_RECOMMENDED",
    "DESTRUCTIVE_CLEANUP_REQUIRED",
    "NEEDS_MULTIPLE_AUTO_CLEANUP_CYCLES",
    "RECOVERABLE_BY_AUTO_CLEANUP",
    "WITHIN_BUDGET",
    "assess_lab_cleanup_recoverability",
    "build_partition_drop_sql",
    "enrich_partition_drop_candidates",
    "should_pause_lab_for_recoverability",
]
