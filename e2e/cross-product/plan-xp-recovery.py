#!/usr/bin/env python3
"""Build or dry-run-validate a recovery plan for a Cross-Product run."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from recovery_lib import (  # noqa: E402
    EXPECTED_FIXED_COMMIT,
    EXPECTED_FIXED_HARNESS,
    build_recovery_plan,
    compute_harness_version,
    determine_status,
    load_immutable_run_manifest,
    read_json,
    resolve_reports_root_detailed,
    resolve_run_dir,
    validate_all_shards,
)


def _git_head(repo: Path) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(repo), "rev-parse", "HEAD"], text=True
        ).strip()
    except Exception:
        return "unknown"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", default="xp_full_on_20260717_101601")
    ap.add_argument(
        "--reports-root",
        default="",
        help="Absolute reports root (overrides GDC_E2E_REPORTS_ROOT)",
    )
    ap.add_argument(
        "--attempt",
        default="",
        help="Attempt dir name under run (e.g. recovery-attempt-001)",
    )
    ap.add_argument(
        "--attempt-dir",
        default="",
        help="Optional absolute/relative attempt directory",
    )
    ap.add_argument("--dry-run", action="store_true", help="Validate only; no writes")
    args = ap.parse_args()

    e2e = ROOT / "e2e"
    reports_root, source = resolve_reports_root_detailed(
        args.reports_root or None,
        repo_root=ROOT,
    )

    try:
        run_dir = resolve_run_dir(
            args.run_id,
            reports_root=reports_root,
            must_exist=True,
        )
    except FileNotFoundError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        print(f"reports_root_source={source}", file=sys.stderr)
        return 2

    # Resolve attempt directory
    if args.attempt_dir:
        attempt_dir = Path(args.attempt_dir).expanduser().resolve()
    elif args.attempt:
        attempt_dir = (run_dir / args.attempt).resolve()
    else:
        attempt_dir = None

    current_commit = _git_head(ROOT)
    live = compute_harness_version(root=ROOT, commit=current_commit)
    imm = load_immutable_run_manifest(run_dir, allow_bootstrap_write=not args.dry_run)
    expected_commit = (imm or {}).get("git_commit") or EXPECTED_FIXED_COMMIT
    expected_harness = (imm or {}).get("harness_version") or EXPECTED_FIXED_HARNESS

    status = determine_status(
        run_dir=run_dir,
        e2e_root=e2e,
        reports_root=reports_root,
        allow_bootstrap_write=not args.dry_run,
    )
    validation = validate_all_shards(run_dir=run_dir, e2e_root=e2e)

    shards_executed = 0
    files_written = False
    lock_created = False
    plan: dict

    if args.dry_run:
        if attempt_dir is None:
            print(
                "ERROR: --dry-run requires --attempt or --attempt-dir "
                "(read-only validation of an existing recovery plan)",
                file=sys.stderr,
            )
            return 2
        plan_path = attempt_dir / "recovery-plan.json"
        if not plan_path.is_file():
            print(f"ERROR: recovery-plan.json missing: {plan_path}", file=sys.stderr)
            return 2
        plan = read_json(plan_path) or {}
        # Recompute live validation counts; do not rewrite plan files.
    else:
        plan = build_recovery_plan(
            run_dir=run_dir,
            e2e_root=e2e,
            attempt_dir=attempt_dir,
        )
        files_written = True
        attempt_dir = Path(plan["attempt_dir"])

    summary = {
        "dry_run": bool(args.dry_run),
        "shards_executed": shards_executed,
        "files_written": files_written,
        "lock_created": lock_created,
        "reports_root": str(reports_root),
        "reports_root_source": source,
        "run_dir": str(run_dir),
        "attempt_dir": str(attempt_dir) if attempt_dir else None,
        "worktree": str(ROOT),
        "current_commit": current_commit,
        "expected_commit": expected_commit,
        "commit_match": current_commit == expected_commit,
        "current_harness": live.get("harness_version"),
        "expected_harness": expected_harness,
        "harness_match": live.get("harness_version") == expected_harness,
        "manifest_hash": live.get("manifest_hash"),
        "applicability_rules_hash": live.get("applicability_rules_hash"),
        "axes_hash": live.get("axes_hash"),
        "final_verdict": status.get("final_verdict"),
        "lock_status": status.get("lock_status"),
        "orchestrator_alive": status.get("orchestrator_alive"),
        "playwright_alive": status.get("playwright_alive"),
        "abort_reason": status.get("abort_reason"),
        "resumable": status.get("resumable"),
        "immutable": {
            "git_commit": (imm or {}).get("git_commit"),
            "harness_version": (imm or {}).get("harness_version"),
        },
        "validation_by_verdict": validation.get("by_verdict"),
        "trusted_completed_shards": validation.get("trusted_completed_shards")
        or plan.get("reuse_shards"),
        "superseded_shards": validation.get("superseded_shards"),
        "needs_full_rerun": validation.get("needs_full_rerun") or plan.get("rerun_shards"),
        "missing_shards": validation.get("missing_shards"),
        "product_fail_excluded_shards": plan.get("product_fail_excluded_shards"),
        "reuse_shards": plan.get("reuse_shards"),
        "rerun_shards": plan.get("rerun_shards"),
        "reuse_shard_count": len(plan.get("reuse_shards") or []),
        "rerun_shard_count": len(plan.get("rerun_shards") or []),
        "shard_0_replacement_mode": plan.get("shard_0_replacement_mode"),
        "execution": "none" if args.dry_run else "plan_write",
    }
    print(json.dumps(summary, indent=2))

    if args.dry_run:
        if not summary["commit_match"] or not summary["harness_match"]:
            print(
                "WARNING: worktree commit/harness does not match immutable expected values",
                file=sys.stderr,
            )
            return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
