"""CLI for lab retention cleanup (dry-run by default).

Usage:
  python -m app.dev_validation_lab.lab_cleanup_cli
  python -m app.dev_validation_lab.lab_cleanup_cli --execute
  python -m app.dev_validation_lab.lab_cleanup_cli --show-partition-drop-sql
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any
from urllib.parse import unquote, urlparse


def _database_target_info() -> dict[str, Any]:
    from app.config import settings
    from app.dev_validation_lab.seeder import lab_effective

    raw = str(getattr(settings, "DATABASE_URL", "") or "")
    parsed = urlparse(raw)
    host = parsed.hostname or "unknown"
    port = parsed.port if parsed.port is not None else 5432
    database = unquote((parsed.path or "/").lstrip("/") or "unknown")
    user = unquote(parsed.username or "unknown")
    mode = str(getattr(settings, "APP_ENV", "") or "unknown")
    return {
        "host": host,
        "port": port,
        "database": database,
        "user": user,
        "mode": mode,
        "lab_effective": bool(lab_effective()),
    }


def _print_partition_drop_safety_banner(target: dict[str, Any]) -> None:
    print("Database target:")
    print(f"host: {target['host']}")
    print(f"port: {target['port']}")
    print(f"database: {target['database']}")
    print(f"user: {target['user']}")
    print(f"mode: {target['mode']}")
    print(f"lab_effective: {str(target['lab_effective']).lower()}")
    print("")
    print("WARNING:")
    print("DRY RUN ONLY.")
    print("This command does not execute DROP.")
    print("Review the target database before manually executing SQL.")
    print("")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Lab retention cleanup (preview by default; --execute deletes old lab rows)."
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Perform deletes. Without this flag, only dry-run stats are printed.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print result as JSON.",
    )
    parser.add_argument(
        "--show-partition-drop-sql",
        action="store_true",
        help=(
            "Print DROP TABLE statements for retention-safe delivery_logs partitions only. "
            "Never executes DROP/TRUNCATE/VACUUM FULL."
        ),
    )
    args = parser.parse_args(argv)

    from app.database import SessionLocal
    from app.dev_validation_lab.lab_cleanup_recoverability import (
        assess_lab_cleanup_recoverability,
        build_partition_drop_sql,
        enrich_partition_drop_candidates,
    )
    from app.dev_validation_lab.lab_retention import execute_lab_cleanup, lab_retention_settings

    cfg = lab_retention_settings()
    if args.execute:
        print(
            "WARNING: --execute will DELETE old rows from platform_alert_history, "
            "stream_replay_events, and delivery_logs per lab retention days.",
            file=sys.stderr,
        )
        print(
            "This does NOT drop current/next-month delivery_logs partitions. "
            "VACUUM/ANALYZE is NOT run automatically.",
            file=sys.stderr,
        )
        if not cfg["enabled"]:
            print(
                "ERROR: lab retention is not enabled (lab_effective + GDC_LAB_RETENTION_ENABLED).",
                file=sys.stderr,
            )
            return 2

    db = SessionLocal()
    try:
        if args.show_partition_drop_sql:
            target = _database_target_info()
            print(
                "WARNING: The following SQL is for MANUAL operator review only. "
                "This CLI does NOT execute DROP/TRUNCATE/VACUUM FULL.",
                file=sys.stderr,
            )
            print(
                "Only partitions with safe_to_drop_candidate=true (fully older than retention, "
                "not current/next month) are listed.",
                file=sys.stderr,
            )
            cands = enrich_partition_drop_candidates(
                db,
                retention_days=int(cfg.get("delivery_log_retention_days") or 7),
                cheap=True,
            )
            sqls = build_partition_drop_sql(cands)
            recover = assess_lab_cleanup_recoverability(
                delivery_logs_eligible_rows=sum(
                    int(c.get("estimated_rows") or 0) for c in cands if c.get("safe_to_drop_candidate")
                ),
                partition_candidates=cands,
            )
            if args.json:
                print(
                    json.dumps(
                        {
                            "database_target": target,
                            "dry_run": True,
                            "executed": False,
                            "partition_drop_candidates": cands,
                            "drop_sql": sqls,
                            "recoverability": recover,
                        },
                        indent=2,
                        default=str,
                    )
                )
            else:
                _print_partition_drop_safety_banner(target)
                print(f"recoverability_status={recover.get('recoverability_status')}")
                print(f"recommended_action={recover.get('recommended_action')}")
                print(f"safe_drop_candidates={len(sqls)} (SQL not executed)")
                for c in cands:
                    print(
                        f"  {c.get('partition_name')}: safe={c.get('safe_to_drop_candidate')} "
                        f"rows={c.get('estimated_rows')} size={c.get('estimated_size_bytes')} "
                        f"range={c.get('min_created_at')}..{c.get('max_created_at')} "
                        f"reason={c.get('reason')}"
                    )
                if sqls:
                    print("-- BEGIN manual review SQL (not executed) --")
                    for block in sqls:
                        print(block)
                        print("")
                    print("-- END manual review SQL --")
                else:
                    print("No safe_to_drop_candidate partitions.")
            return 0

        result = execute_lab_cleanup(db, execute=bool(args.execute))
    finally:
        db.close()

    if args.json:
        print(json.dumps(result, indent=2, default=str))
    else:
        print(f"lab_effective={cfg.get('lab_effective')} retention_enabled={cfg.get('enabled')}")
        print(f"execute={result.get('execute')} message={result.get('message')}")
        for row in result.get("tables") or []:
            print(
                f"  {row.get('table')}: eligible={row.get('rows_eligible')} "
                f"cutoff={row.get('cutoff_utc')} days={row.get('retention_days')}"
            )
        for o in result.get("outcomes") or []:
            print(
                f"  outcome {o.get('table')}: status={o.get('status')} "
                f"matched={o.get('matched_count')} deleted={o.get('deleted_count')}"
            )
        cands = result.get("partition_drop_candidates") or []
        if cands:
            print(f"partition_drop_candidates (not dropped): {len(cands)}")
            for c in cands:
                print(
                    f"  {c.get('partition_name')} rows={c.get('estimated_rows') or c.get('row_count')} "
                    f"size={c.get('estimated_size_bytes')} safe={c.get('safe_to_drop_candidate')} "
                    f"reason={c.get('reason')}"
                )
        if result.get("vacuum_analyze_recommendation"):
            print(result["vacuum_analyze_recommendation"])
        errs = result.get("errors") or []
        if errs:
            print("errors:")
            for e in errs:
                print(f"  {e}")

    return 1 if result.get("errors") and args.execute else 0


if __name__ == "__main__":
    raise SystemExit(main())
