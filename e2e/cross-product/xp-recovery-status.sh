#!/usr/bin/env bash
# Emit recovery status snapshot for a Cross-Product run.
# Separates original_run.final_verdict from recovery_attempt status.
# Does NOT treat lock-file presence alone as IN_PROGRESS.
#
# Reports root priority: --reports-root > GDC_E2E_REPORTS_ROOT > <repo>/e2e/reports
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E="$ROOT/e2e"
RUN_ID="xp_full_on_20260717_101601"
ATTEMPT=""
REPORTS_ROOT_CLI=""
WRITE_SNAPSHOT=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id) RUN_ID="$2"; shift 2 ;;
    --attempt) ATTEMPT="$2"; shift 2 ;;
    --reports-root) REPORTS_ROOT_CLI="$2"; shift 2 ;;
    --no-write) WRITE_SNAPSHOT=0; shift ;;
    -h|--help)
      echo "Usage: $0 [--run-id ID] [--attempt NAME] [--reports-root PATH] [--no-write] [RUN_ID]"
      exit 0
      ;;
    *)
      if [[ "$1" != -* ]]; then
        RUN_ID="$1"
        shift
      else
        echo "Unknown arg: $1" >&2
        exit 2
      fi
      ;;
  esac
done

python3 - <<PY
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path("$E2E") / "cross-product"))
from recovery_lib import (
    determine_attempt_status,
    determine_status,
    load_attempt_status,
    load_immutable_run_manifest,
    load_shard_plan_snapshot,
    read_json,
    resolve_reports_root_detailed,
    resolve_run_dir,
)

cli = """$REPORTS_ROOT_CLI""".strip() or None
reports_root, source = resolve_reports_root_detailed(cli, repo_root=Path("$ROOT"))
try:
    run_dir = resolve_run_dir("$RUN_ID", reports_root=reports_root, must_exist=True)
except FileNotFoundError as exc:
    print(f"ERROR: {exc}", file=sys.stderr)
    raise SystemExit(2)

e2e_root = Path("$E2E")
out = determine_status(
    run_dir=run_dir,
    e2e_root=e2e_root,
    reports_root=reports_root,
    allow_bootstrap_write=False,
)
out["reports_root"] = str(reports_root)
out["reports_root_source"] = source
out["run_dir"] = str(run_dir)

from collections import Counter

art = run_dir / "xp-normal-000-ROUTE_ON"
res = art / "cross-product-results.jsonl"
if not res.exists() and (art / "original" / "cross-product-results.jsonl").exists():
    res = art / "original" / "cross-product-results.jsonl"
rows = []
if res.exists():
    rows = [json.loads(l) for l in res.read_text().splitlines() if l.strip()]
c = Counter(r.get("status") for r in rows)
imm = load_immutable_run_manifest(run_dir, allow_bootstrap_write=False) or {}
out.update(
    {
        "shard0_executed": len(rows),
        "shard0_expected": 1050,
        "shard0_by_status": dict(c),
        "shard0_superseded": (art / "superseded.json").exists(),
        "immutable_run_manifest": {
            "git_commit": imm.get("git_commit"),
            "harness_version": imm.get("harness_version"),
        },
    }
)

# Separate original run vs recovery attempt status (never overwrite original verdict).
# Never auto-select recovery-attempt-dry-run as a real attempt.
attempt_name = """$ATTEMPT""".strip()
if not attempt_name:
    attempts = sorted(
        p
        for p in run_dir.glob("recovery-attempt-*")
        if p.is_dir() and "dry-run" not in p.name.lower()
    )
    attempt_name = attempts[-1].name if attempts else ""
elif "dry-run" in attempt_name.lower():
    print(
        "ERROR: recovery-attempt-dry-run is not a real attempt; pass --attempt recovery-attempt-NNN",
        file=sys.stderr,
    )
    raise SystemExit(2)

original_run = {
    "run_id": run_dir.name,
    "final_verdict": out.get("final_verdict"),
    "abort_reason": out.get("abort_reason"),
    "resumable": out.get("resumable"),
    "lock_status": out.get("lock_status"),
}
out["original_run"] = original_run

recovery_attempt = None
if attempt_name:
    attempt_dir = run_dir / attempt_name
    if attempt_dir.is_dir():
        recovery_attempt = determine_attempt_status(attempt_dir)
        snap = load_shard_plan_snapshot(attempt_dir)
        recovery_attempt["snapshot_present"] = bool(snap)
        recovery_attempt["snapshot_hash"] = (snap or {}).get("snapshot_hash")
        recovery_attempt["snapshot_shard_count"] = (snap or {}).get("shard_count")
        # Side-run invalidation visibility
        side = reports_root / f"{run_dir.name}__{attempt_name}__xp-normal-000"
        zinv = read_json(side / "zero-shard-invalid.json")
        if zinv:
            recovery_attempt["zero_shard_side_run"] = zinv
        # Canary generation / result visibility (does not mutate original run).
        side_art = side / "xp-normal-000-ROUTE_ON"
        side_res = side_art / "cross-product-results.jsonl"
        canary_gen = side.name if side.is_dir() else None
        # Prefer newest gN side run if present
        gens = sorted(reports_root.glob(f"{run_dir.name}__{attempt_name}__xp-normal-000__g*"))
        if gens:
            canary_gen = gens[-1].name
            side_res = gens[-1] / "xp-normal-000-ROUTE_ON" / "cross-product-results.jsonl"
            side_art = gens[-1] / "xp-normal-000-ROUTE_ON"
        recovery_attempt["current_canary_generation"] = canary_gen
        recovery_attempt["current_shard"] = recovery_attempt.get("current_shard") or "xp-normal-000"
        if side_res.is_file():
            from collections import Counter
            rows = [json.loads(l) for l in side_res.read_text().splitlines() if l.strip()]
            st = Counter(r.get("status") for r in rows)
            recovery_attempt["canary_expected"] = int(recovery_attempt.get("current_expected") or 1050)
            recovery_attempt["canary_executed_count"] = len(rows)
            recovery_attempt["canary_pass"] = int(st.get("PASS", 0))
            recovery_attempt["canary_fail"] = int(st.get("FAIL", 0))
            recovery_attempt["canary_unique"] = len({r.get("combination_id") for r in rows})
        # Canary replacement status
        rep_dir = attempt_dir / "replacements" / "xp-normal-000-ROUTE_ON"
        rep = rep_dir / "validation.json"
        failed_reps = sorted((attempt_dir / "replacements").glob(".failed-attempt-xp-normal-000-*"))
        if rep.exists():
            recovery_attempt["canary_validation"] = read_json(rep)
            recovery_attempt["replacement_status"] = "PUBLISHED"
            recovery_attempt["replacement_path"] = str(rep_dir)
        elif failed_reps:
            recovery_attempt["replacement_status"] = "QUARANTINED_FAILED"
            recovery_attempt["replacement_path"] = str(failed_reps[-1])
        elif rep_dir.exists():
            recovery_attempt["replacement_status"] = "PARTIAL_OR_EMPTY"
            recovery_attempt["replacement_path"] = str(rep_dir)
        else:
            recovery_attempt["replacement_status"] = "NOT_PUBLISHED"
            recovery_attempt["replacement_path"] = str(rep_dir)
        # Plan remaining shard counts
        plan = read_json(attempt_dir / "recovery-plan.json") or {}
        reuse = list(plan.get("reuse_shards") or [])
        rerun = list(plan.get("rerun_shards") or [])
        recovery_attempt["reuse_count"] = len(reuse)
        recovery_attempt["rerun_count"] = len(rerun)
        recovery_attempt["remaining_shard_count"] = len(rerun)
        recovery_attempt["canary_required_plan"] = bool(plan.get("canary_required"))

out["recovery_attempt"] = recovery_attempt

print(json.dumps(out, indent=2))
if int("$WRITE_SNAPSHOT") == 1:
    (run_dir / "status-snapshot.json").write_text(json.dumps(out, indent=2) + "\n")
    if attempt_name and (run_dir / attempt_name).is_dir():
        # Attempt-local mirror; does not mutate original run verdict files.
        (run_dir / attempt_name / "status-snapshot.json").write_text(
            json.dumps(
                {
                    "original_run": original_run,
                    "recovery_attempt": recovery_attempt,
                    "captured_at": out.get("captured_at"),
                },
                indent=2,
            )
            + "\n"
        )
PY
