#!/usr/bin/env bash
# Run all Cross-Product shards for the current route-processing mode.
# Usage:
#   GDC_ROUTE_PROCESSING_ENABLED=true GDC_XP_ROUTE_RUNTIME=ROUTE_ON \
#     ./e2e/cross-product/run-all-shards.sh
#   GDC_ROUTE_PROCESSING_ENABLED=false GDC_XP_ROUTE_RUNTIME=ROUTE_OFF \
#     ./e2e/cross-product/run-all-shards.sh
#
# Optional:
#   GDC_XP_SHARD_FILTER=xp-normal-000   # single shard
#   GDC_XP_CONTINUE=1                   # skip shards that already have results
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E="$ROOT/e2e"
GEN="$E2E/cross-product/generated"
RUN_ID="${GDC_E2E_RUN_ID:-xp_full_$(date -u +%Y%m%d_%H%M%S)}"
export GDC_E2E_RUN_ID="$RUN_ID"
ROUTE_RUNTIME="${GDC_XP_ROUTE_RUNTIME:-ROUTE_ON}"
export GDC_XP_ROUTE_RUNTIME="$ROUTE_RUNTIME"
export PLAYWRIGHT_API_BASE_URL="${PLAYWRIGHT_API_BASE_URL:-http://127.0.0.1:18000}"
export PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:4173}"

# Full shard runs must never inherit preflight/smoke filters.
# Preflight and explicit limited re-runs call playwright directly (not this script).
# Recovery may pass an explicit file-based selector (GDC_XP_COMBINATION_IDS_FILE) —
# comma-env GDC_XP_COMBINATION_IDS and GDC_XP_LIMIT remain forbidden here.
if [[ -n "${GDC_XP_COMBINATION_IDS:-}" || -n "${GDC_XP_LIMIT:-}" ]]; then
  echo "ERROR: full shard run refuses residual filters:" >&2
  echo "  GDC_XP_COMBINATION_IDS=${GDC_XP_COMBINATION_IDS:-"(unset)"}" >&2
  echo "  GDC_XP_LIMIT=${GDC_XP_LIMIT:-"(unset)"}" >&2
  echo "Unset both before run-all-shards.sh, or use a preflight/limited command." >&2
  echo "For recovery selectors use GDC_XP_COMBINATION_IDS_FILE instead." >&2
  exit 1
fi
unset GDC_XP_EXECUTION_SURFACE

# Prefer recovery/runtime shard-plan override; never silently proceed without a plan.
SHARD_PLAN_PATH="${GDC_XP_SHARD_PLAN_PATH:-$GEN/shard-plan.json}"
if [[ ! -f "$SHARD_PLAN_PATH" ]]; then
  echo "ERROR: FAILED_PREFLIGHT_SHARD_PLAN_MISSING: $SHARD_PLAN_PATH" >&2
  exit 43
fi

COMMIT="${GDC_XP_COMMIT:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}"
MANIFEST_HASH="$(python3 -c "import json;print(json.load(open('$GEN/generation-summary.json'))['manifest_hash'])")"
RULES_HASH="$(python3 -c "import json;print(json.load(open('$GEN/generation-summary.json'))['applicability_rules_hash'])")"
AXES_HASH="$(python3 -c "import json;print(json.load(open('$GEN/generation-summary.json'))['axes_hash'])")"

# Expanded harness scope (must match harness-version.ts / recovery_lib.compute_harness_version).
HARNESS_JSON="$(
ROOT_ENV="$ROOT" COMMIT_ENV="$COMMIT" python3 - <<'PY'
import json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(os.environ["ROOT_ENV"]) / "e2e" / "cross-product"))
from recovery_lib import compute_harness_version
print(json.dumps(compute_harness_version(root=Path(os.environ["ROOT_ENV"]), commit=os.environ["COMMIT_ENV"])))
PY
)"
EXECUTOR_HASH="$(python3 -c "import json,sys;print(json.load(sys.stdin)['executor_hash'])" <<<"$HARNESS_JSON")"
DRIVER_HASH="$(python3 -c "import json,sys;print(json.load(sys.stdin)['driver_hash'])" <<<"$HARNESS_JSON")"
SPEC_HASH="$(python3 -c "import json,sys;print(json.load(sys.stdin)['spec_hash'])" <<<"$HARNESS_JSON")"
ORACLE_HASH="$(python3 -c "import json,sys;print(json.load(sys.stdin)['oracle_hash'])" <<<"$HARNESS_JSON")"
FIXTURE_HASH="$(python3 -c "import json,sys;print(json.load(sys.stdin)['fixture_hash'])" <<<"$HARNESS_JSON")"
HARNESS_VERSION="$(python3 -c "import json,sys;print(json.load(sys.stdin)['harness_version'])" <<<"$HARNESS_JSON")"

# Reports root: GDC_E2E_REPORTS_ROOT > <repo>/e2e/reports
REPORTS_ROOT="${GDC_E2E_REPORTS_ROOT:-$E2E/reports}"
REPORTS_ROOT="$(python3 -c "import os;from pathlib import Path;print(Path(os.path.expanduser('$REPORTS_ROOT')).resolve())")"
META_DIR="$REPORTS_ROOT/$RUN_ID"
mkdir -p "$META_DIR"
# Immutable run manifest: created once, never overwritten. Resume compares against it.
ABORT_RC=0
python3 - <<PY
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path("$E2E") / "cross-product"))
from recovery_lib import (
    create_immutable_run_manifest,
    load_immutable_run_manifest,
    compare_to_immutable,
    write_run_abort,
    utc_now,
)

meta_dir = Path("$META_DIR")
# Legacy runs: bootstrap immutable from expected-fixed-harness.json before any write.
existing_imm = load_immutable_run_manifest(meta_dir)
current = {
  "run_id": "$RUN_ID",
  "commit": "$COMMIT",
  "git_commit": "$COMMIT",
  "manifest_hash": "$MANIFEST_HASH",
  "applicability_rules_hash": "$RULES_HASH",
  "axes_hash": "$AXES_HASH",
  "executor_hash": "$EXECUTOR_HASH",
  "driver_hash": "$DRIVER_HASH",
  "spec_hash": "$SPEC_HASH",
  "oracle_hash": "$ORACLE_HASH",
  "fixture_hash": "$FIXTURE_HASH",
  "harness_version": "$HARNESS_VERSION",
  "route_runtime": "$ROUTE_RUNTIME",
  "route_processing_enabled": "${GDC_ROUTE_PROCESSING_ENABLED:-}",
  "started_at": utc_now(),
}
if existing_imm and existing_imm.get("harness_version"):
    imm = existing_imm
    created = False
else:
    imm, created = create_immutable_run_manifest(meta_dir, current)
if not created:
    # Resume: never rewrite immutable; compare live hashes to frozen values.
    mismatches = compare_to_immutable(imm, current)
    expected_env = "${GDC_XP_EXPECTED_HARNESS:-}"
    if expected_env and current["harness_version"] != expected_env:
        mismatches.append(
            f"harness_version: expected={expected_env} actual={current['harness_version']}"
        )
    if mismatches:
        write_run_abort(
            meta_dir,
            abort_reason="HARNESS_DRIFT",
            expected=imm,
            actual=current,
            detail={"mismatches": mismatches, "phase": "run_start"},
        )
        print(json.dumps({"status": "ABORTED", "abort_reason": "HARNESS_DRIFT", "mismatches": mismatches}, indent=2))
        raise SystemExit(42)
    # Preserve original started_at / harness fields in run-metadata; refresh only non-immutable bookkeeping.
    meta = dict(imm)
    meta["route_processing_enabled"] = current.get("route_processing_enabled")
    meta["resume_at"] = utc_now()
    meta["live_harness_version"] = current["harness_version"]
    meta["live_git_commit"] = current["git_commit"]
else:
    meta = dict(current)

# Compat: harness-manifest.json reflects immutable source of truth (not live drift).
json.dump(meta, open(meta_dir / "run-metadata.json", "w"), indent=2)
json.dump(
    {k: meta.get(k) for k in [
        "run_id","git_commit","commit","harness_version","manifest_hash",
        "applicability_rules_hash","axes_hash","executor_hash","driver_hash",
        "spec_hash","oracle_hash","fixture_hash","route_runtime","started_at",
    ] if meta.get(k) is not None},
    open(meta_dir / "harness-manifest.json", "w"),
    indent=2,
)
print(json.dumps({
    "harness_version": meta.get("harness_version"),
    "commit": meta.get("git_commit") or meta.get("commit"),
    "immutable_created": created,
}, indent=2))
PY
ABORT_RC=$?
if [[ "$ABORT_RC" -eq 42 ]]; then
  echo "ERROR: HARNESS_DRIFT at run start — aborting without executing shards" >&2
  exit 42
elif [[ "$ABORT_RC" -ne 0 ]]; then
  echo "ERROR: failed to initialize immutable run manifest (rc=$ABORT_RC)" >&2
  exit "$ABORT_RC"
fi
# Pin subsequent shard checks to immutable harness when present.
if [[ -z "${GDC_XP_EXPECTED_HARNESS:-}" && -f "$META_DIR/immutable-run-manifest.json" ]]; then
  GDC_XP_EXPECTED_HARNESS="$(python3 -c "import json;print(json.load(open('$META_DIR/immutable-run-manifest.json'))['harness_version'])")"
  export GDC_XP_EXPECTED_HARNESS
fi
# Prefer immutable commit for row metadata when resuming under a drifted HEAD.
if [[ -f "$META_DIR/immutable-run-manifest.json" ]]; then
  IMM_COMMIT="$(python3 -c "import json;print(json.load(open('$META_DIR/immutable-run-manifest.json')).get('git_commit') or '')")"
  IMM_HARNESS="$(python3 -c "import json;print(json.load(open('$META_DIR/immutable-run-manifest.json')).get('harness_version') or '')")"
  if [[ -n "$IMM_COMMIT" ]]; then
    COMMIT="$IMM_COMMIT"
  fi
  if [[ -n "$IMM_HARNESS" && "$HARNESS_VERSION" != "$IMM_HARNESS" ]]; then
    echo "ERROR: live harness drifted from immutable before shard loop" >&2
    echo "  live=$HARNESS_VERSION" >&2
    echo "  immutable=$IMM_HARNESS" >&2
    python3 - <<PY
import sys
from pathlib import Path
sys.path.insert(0, str(Path("$E2E") / "cross-product"))
from recovery_lib import load_immutable_run_manifest, write_run_abort
imm = load_immutable_run_manifest(Path("$META_DIR"))
write_run_abort(
  Path("$META_DIR"),
  abort_reason="HARNESS_DRIFT",
  expected=imm or {},
  actual={"git_commit": "$COMMIT", "harness_version": "$HARNESS_VERSION"},
  detail={"phase": "pre_shard_loop"},
)
PY
    exit 42
  fi
fi

SHARD_LIST_FILE="$(mktemp)"
trap 'rm -f "$SHARD_LIST_FILE"' EXIT
set +e
SHARD_PLAN_PATH="$SHARD_PLAN_PATH" python3 - <<'PY' >"$SHARD_LIST_FILE"
import json, os, sys
plan_path = os.environ["SHARD_PLAN_PATH"]
try:
    plan = json.load(open(plan_path))
except FileNotFoundError:
    print(f"ERROR: FAILED_PREFLIGHT_SHARD_PLAN_MISSING: {plan_path}", file=sys.stderr)
    raise SystemExit(43)
filt = os.environ.get("GDC_XP_SHARD_FILTER", "").strip()
ids_file = (os.environ.get("GDC_XP_COMBINATION_IDS_FILE") or "").strip()
selected = 0
combo_total = 0
for s in plan.get("shards") or []:
    sid = s["shard_id"]
    if filt and sid != filt:
        continue
    ids = list(s.get("combination_ids") or [])
    if ids_file:
        wanted = {line.strip() for line in open(ids_file) if line.strip()}
        ids = [i for i in ids if i in wanted]
    if not ids and int(s.get("expected_count") or 0) <= 0 and not ids_file:
        # legacy full plan may omit expected_count; combination_ids required
        pass
    expected = int(s.get("expected_count") or len(ids) or 0)
    if expected <= 0:
        print(f"ERROR: shard {sid} has expected_count=0", file=sys.stderr)
        raise SystemExit(44)
    print(sid)
    selected += 1
    combo_total += expected
if selected <= 0:
    print("ERROR: FAILED_PREFLIGHT_ZERO_SHARDS selected_shards=0", file=sys.stderr)
    raise SystemExit(44)
if combo_total <= 0:
    print("ERROR: FAILED_PREFLIGHT_ZERO_SHARDS selected_combinations=0", file=sys.stderr)
    raise SystemExit(44)
print(f"PREFLIGHT_OK selected_shards={selected} selected_combinations={combo_total}", file=sys.stderr)
PY
SHARD_LOAD_RC=$?
set -e
if [[ "$SHARD_LOAD_RC" -ne 0 ]]; then
  echo "ERROR: shard-plan load/preflight failed rc=$SHARD_LOAD_RC" >&2
  python3 - <<PY
import json
from pathlib import Path
from datetime import datetime, timezone
meta_dir = Path("$META_DIR")
meta_path = meta_dir / "run-metadata.json"
meta = json.loads(meta_path.read_text()) if meta_path.exists() else {"run_id": "$RUN_ID"}
meta["status"] = "FAILED_PREFLIGHT"
meta["complete"] = False
meta["failed_shards"] = 0
meta["reason"] = "FAILED_PREFLIGHT_SHARD_PLAN_MISSING" if $SHARD_LOAD_RC == 43 else "FAILED_PREFLIGHT_ZERO_SHARDS"
meta["ended_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
meta_path.write_text(json.dumps(meta, indent=2) + "\n")
print(json.dumps({k: meta.get(k) for k in ["run_id","status","reason","complete","ended_at"]}, indent=2))
PY
  exit "$SHARD_LOAD_RC"
fi
mapfile -t SHARDS < <(grep -v '^PREFLIGHT_OK' "$SHARD_LIST_FILE" || true)
# Drop any accidental non-shard lines
SHARDS=("${SHARDS[@]}")

if [[ "${#SHARDS[@]}" -eq 0 ]]; then
  echo "ERROR: FAILED_PREFLIGHT_ZERO_SHARDS after load" >&2
  python3 - <<PY
import json
from pathlib import Path
from datetime import datetime, timezone
meta_path = Path("$META_DIR/run-metadata.json")
meta = json.loads(meta_path.read_text()) if meta_path.exists() else {"run_id": "$RUN_ID"}
meta["status"] = "FAILED_PREFLIGHT"
meta["complete"] = False
meta["reason"] = "FAILED_PREFLIGHT_ZERO_SHARDS"
meta["ended_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
meta_path.write_text(json.dumps(meta, indent=2) + "\n")
PY
  exit 44
fi

echo "RUN_ID=$RUN_ID route=$ROUTE_RUNTIME shards=${#SHARDS[@]} commit=$COMMIT plan=$SHARD_PLAN_PATH"

cd "$E2E"
FAILED=0
INCOMPLETE=0
for shard in "${SHARDS[@]}"; do
  ART_DIR="${shard}-${ROUTE_RUNTIME}"
  RESULT="$META_DIR/$ART_DIR/cross-product-results.jsonl"
  if [[ "${GDC_XP_CONTINUE:-0}" == "1" && -f "$RESULT" ]]; then
    echo "SKIP $shard (results exist)"
    continue
  fi
  echo "==== START $shard @ $(date -u +%H:%M:%SZ) ===="
  START_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Recompute harness hashes per shard so a long-lived orchestrator picks up harness fixes.
  HARNESS_JSON="$(
  ROOT_ENV="$ROOT" COMMIT_ENV="$COMMIT" python3 - <<'PY'
import json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(os.environ["ROOT_ENV"]) / "e2e" / "cross-product"))
from recovery_lib import compute_harness_version
print(json.dumps(compute_harness_version(root=Path(os.environ["ROOT_ENV"]), commit=os.environ["COMMIT_ENV"])))
PY
  )"
  EXECUTOR_HASH="$(python3 -c "import json,sys;print(json.load(sys.stdin)['executor_hash'])" <<<"$HARNESS_JSON")"
  DRIVER_HASH="$(python3 -c "import json,sys;print(json.load(sys.stdin)['driver_hash'])" <<<"$HARNESS_JSON")"
  SPEC_HASH="$(python3 -c "import json,sys;print(json.load(sys.stdin)['spec_hash'])" <<<"$HARNESS_JSON")"
  ORACLE_HASH="$(python3 -c "import json,sys;print(json.load(sys.stdin)['oracle_hash'])" <<<"$HARNESS_JSON")"
  FIXTURE_HASH="$(python3 -c "import json,sys;print(json.load(sys.stdin)['fixture_hash'])" <<<"$HARNESS_JSON")"
  HARNESS_VERSION="$(python3 -c "import json,sys;print(json.load(sys.stdin)['harness_version'])" <<<"$HARNESS_JSON")"

  # Per-shard preflight: full mode, no residual filters, harness hash present, expected count known.
  if [[ -n "${GDC_XP_COMBINATION_IDS:-}" || -n "${GDC_XP_LIMIT:-}" ]]; then
    echo "ERROR: residual filter env leaked before shard=$shard — refusing to start" >&2
    FAILED=$((FAILED + 1))
    mkdir -p "$META_DIR/$ART_DIR"
    echo '{"status":"FAIL","reason":"residual_filter_env"}' >"$META_DIR/$ART_DIR/shard-preflight-fail.json"
    continue
  fi
  if [[ -z "$HARNESS_VERSION" || -z "$EXECUTOR_HASH" || -z "$DRIVER_HASH" ]]; then
    echo "ERROR: harness hashes missing before shard=$shard — refusing to start" >&2
    FAILED=$((FAILED + 1))
    mkdir -p "$META_DIR/$ART_DIR"
    echo '{"status":"FAIL","reason":"missing_harness_hash"}' >"$META_DIR/$ART_DIR/shard-preflight-fail.json"
    continue
  fi
  if [[ -n "${GDC_XP_EXPECTED_HARNESS:-}" && "$HARNESS_VERSION" != "$GDC_XP_EXPECTED_HARNESS" ]]; then
    echo "ERROR: HARNESS_DRIFT before shard=$shard — aborting run (no further shards)" >&2
    echo "  computed=$HARNESS_VERSION" >&2
    echo "  expected=$GDC_XP_EXPECTED_HARNESS" >&2
    # Do NOT start this shard, do NOT continue remaining shards, do NOT inflate product failed_shards.
    python3 - <<PY
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path("$E2E") / "cross-product"))
from recovery_lib import load_immutable_run_manifest, write_run_abort, utc_now
meta_dir = Path("$META_DIR")
imm = load_immutable_run_manifest(meta_dir) or {}
write_run_abort(
  meta_dir,
  abort_reason="HARNESS_DRIFT",
  expected={
    "git_commit": imm.get("git_commit") or "",
    "harness_version": "$GDC_XP_EXPECTED_HARNESS",
  },
  actual={"git_commit": "$COMMIT", "harness_version": "$HARNESS_VERSION"},
  detail={
    "phase": "pre_shard",
    "shard_not_started": "$shard",
    "remaining_shards_skipped": True,
  },
)
# Marker for operators; not counted as product FAIL.
(meta_dir / "run-abort.json").exists()
meta = json.loads((meta_dir / "run-metadata.json").read_text()) if (meta_dir / "run-metadata.json").exists() else {}
meta["status"] = "ABORTED"
meta["abort_reason"] = "HARNESS_DRIFT"
meta["ended_at"] = utc_now()
# Preserve prior product failures; do not add remaining shards as failed.
meta["aborted_before_shard"] = "$shard"
json.dump(meta, open(meta_dir / "run-metadata.json", "w"), indent=2)
PY
    exit 42
  fi
  EXPECTED_COUNT="$(SHARD_PLAN_PATH="$SHARD_PLAN_PATH" python3 - <<PY
import json, os
plan=json.load(open(os.environ["SHARD_PLAN_PATH"]))
ids_file=(os.environ.get("GDC_XP_COMBINATION_IDS_FILE") or "").strip()
wanted=None
if ids_file:
    wanted={line.strip() for line in open(ids_file) if line.strip()}
for s in plan["shards"]:
    if s["shard_id"]=="$shard":
        ids=list(s.get("combination_ids") or [])
        if wanted is not None:
            ids=[i for i in ids if i in wanted]
        exp=int(s.get("expected_count") or len(ids) or 0)
        print(exp)
        break
else:
    print(0)
PY
)"
  if [[ "${EXPECTED_COUNT}" -le 0 ]]; then
    echo "ERROR: expected combination count is 0 for shard=$shard — refusing to start" >&2
    FAILED=$((FAILED + 1))
    mkdir -p "$META_DIR/$ART_DIR"
    echo '{"status":"FAIL","reason":"expected_count_zero"}' >"$META_DIR/$ART_DIR/shard-preflight-fail.json"
    continue
  fi

  export GDC_XP_SHARD="$shard"
  export GDC_XP_SHARD_PLAN_PATH="$SHARD_PLAN_PATH"
  export GDC_E2E_SHARD_ARTIFACT_DIR="$ART_DIR"
  export GDC_XP_COMMIT="$COMMIT"
  export GDC_XP_MANIFEST_HASH="$MANIFEST_HASH"
  export GDC_XP_RULES_HASH="$RULES_HASH"
  export GDC_XP_AXES_HASH="$AXES_HASH"
  export GDC_XP_HARNESS_VERSION="$HARNESS_VERSION"
  export GDC_XP_EXECUTOR_HASH="$EXECUTOR_HASH"
  export GDC_XP_DRIVER_HASH="$DRIVER_HASH"
  mkdir -p "$META_DIR/$ART_DIR"
  python3 - <<PY
import json
doc = {
  "shard_id": "$shard",
  "route_runtime": "$ROUTE_RUNTIME",
  "commit": "$COMMIT",
  "git_commit": "$COMMIT",
  "manifest_hash": "$MANIFEST_HASH",
  "applicability_rules_hash": "$RULES_HASH",
  "axes_hash": "$AXES_HASH",
  "executor_hash": "$EXECUTOR_HASH",
  "driver_hash": "$DRIVER_HASH",
  "spec_hash": "$SPEC_HASH",
  "oracle_hash": "$ORACLE_HASH",
  "fixture_hash": "$FIXTURE_HASH",
  "harness_version": "$HARNESS_VERSION",
  "expected_combinations": int("$EXPECTED_COUNT"),
  "started_at": "$START_TS",
}
json.dump(doc, open("$META_DIR/$ART_DIR/shard-manifest.json", "w"), indent=2)
json.dump(doc, open("$META_DIR/$ART_DIR/harness-manifest.json", "w"), indent=2)
print(json.dumps({"shard": "$shard", "expected": int("$EXPECTED_COUNT"), "harness_version": "$HARNESS_VERSION"}))
PY
  set +e
  npx playwright test -c playwright.config.ts --project=cross-product --reporter=line 2>&1 | tee "$META_DIR/$ART_DIR/playwright.log"
  RC=${PIPESTATUS[0]}
  set -e
  END_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  python3 - <<PY
import json, os
p = "$META_DIR/$ART_DIR/shard-manifest.json"
m = json.load(open(p))
m["ended_at"] = "$END_TS"
m["exit_code"] = $RC
res = "$RESULT"
if os.path.exists(res):
    rows = [json.loads(l) for l in open(res) if l.strip()]
    from collections import Counter
    c = Counter(r.get("status") for r in rows)
    m["executed"] = len(rows)
    m["by_status"] = dict(c)
else:
    m["executed"] = 0
    m["by_status"] = {}
json.dump(m, open(p, "w"), indent=2)
print(json.dumps({"shard": "$shard", "rc": $RC, **m["by_status"]}, indent=2))
PY
  # Post-run guards: never treat missing/empty results as PASS.
  POST_RC=0
  python3 - <<PY || POST_RC=$?
import json, os, sys
result = "$RESULT"
expected = int("$EXPECTED_COUNT")
if not os.path.exists(result):
    print(json.dumps({"ok": False, "reason": "FAILED_RESULT_MISSING", "shard": "$shard"}))
    raise SystemExit(45)
rows = [json.loads(l) for l in open(result) if l.strip()]
ids = [r.get("combination_id") for r in rows if r.get("combination_id")]
unique = len(set(ids))
doc = {
    "ok": len(rows) > 0 and len(rows) == expected == unique,
    "shard": "$shard",
    "executed": len(rows),
    "unique": unique,
    "expected": expected,
    "reason": None,
}
if len(rows) == 0:
    doc["reason"] = "INCOMPLETE_EXECUTION"
    doc["ok"] = False
elif len(rows) != expected or unique != expected:
    doc["reason"] = "INCOMPLETE_EXECUTION"
    doc["ok"] = False
print(json.dumps(doc))
if not doc["ok"]:
    raise SystemExit(46)
PY
  if [[ $RC -ne 0 ]]; then
    FAILED=$((FAILED + 1))
    echo "FAIL shard=$shard rc=$RC — continuing remaining shards"
  elif [[ $POST_RC -ne 0 ]]; then
    INCOMPLETE=$((INCOMPLETE + 1))
    FAILED=$((FAILED + 1))
    echo "INCOMPLETE shard=$shard post_rc=$POST_RC — refusing COMPLETE"
  else
    echo "PASS shard=$shard"
  fi
done

FINAL_RC="$(
FAILED=$FAILED INCOMPLETE=$INCOMPLETE SHARD_COUNT=${#SHARDS[@]} META_DIR="$META_DIR" python3 - <<'PY'
import json, os, sys
from pathlib import Path
from datetime import datetime, timezone
meta_path = Path(os.environ["META_DIR"]) / "run-metadata.json"
meta = json.load(open(meta_path))
# Never rewrite immutable harness identity fields from a drifted live compute.
imm_path = Path(os.environ["META_DIR"]) / "immutable-run-manifest.json"
if imm_path.exists():
    imm = json.load(open(imm_path))
    for k in (
        "git_commit", "commit", "harness_version", "manifest_hash",
        "applicability_rules_hash", "axes_hash", "executor_hash",
        "driver_hash", "spec_hash", "oracle_hash", "fixture_hash",
        "route_runtime", "started_at",
    ):
        if imm.get(k) is not None:
            meta[k] = imm[k]
            if k == "git_commit":
                meta["commit"] = imm[k]
failed = int(os.environ["FAILED"])
incomplete = int(os.environ["INCOMPLETE"])
shard_count = int(os.environ["SHARD_COUNT"])
meta["ended_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
meta["failed_shards"] = failed
meta["incomplete_shards"] = incomplete
meta["selected_shards"] = shard_count
rc = failed
if meta.get("status") == "ABORTED":
    pass
elif shard_count <= 0:
    meta["status"] = "FAILED_PREFLIGHT"
    meta["complete"] = False
    meta["reason"] = "FAILED_PREFLIGHT_ZERO_SHARDS"
    rc = 44
elif failed == 0 and incomplete == 0:
    # COMPLETE only after real shard execution with results validated above.
    meta["status"] = "COMPLETE"
    meta["complete"] = True
    rc = 0
elif incomplete > 0:
    meta["status"] = "INCOMPLETE"
    meta["complete"] = False
    meta["reason"] = "INCOMPLETE_EXECUTION"
    rc = max(failed, 46)
else:
    meta["status"] = "FAIL"
    meta["complete"] = False
    rc = failed
json.dump(meta, open(meta_path, "w"), indent=2)
print(json.dumps({k: meta.get(k) for k in ["run_id","status","failed_shards","incomplete_shards","complete","reason","harness_version","ended_at"]}, indent=2), file=sys.stderr)
print(rc)
PY
)"

echo "DONE run=$RUN_ID failed_shards=$FAILED incomplete_shards=$INCOMPLETE final_rc=$FINAL_RC"
exit "$FINAL_RC"
