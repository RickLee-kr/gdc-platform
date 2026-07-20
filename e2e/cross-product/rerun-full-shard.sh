#!/usr/bin/env bash
# Re-run an entire Cross-Product shard (all expected combination_ids).
# Do NOT use for FAIL-only recovery of untrusted harness results.
#
# Usage:
#   ./e2e/cross-product/rerun-full-shard.sh \
#     --source-run-id xp_full_on_20260717_101601 \
#     --shard xp-normal-000 \
#     --route-processing on
#
# Optional:
#   --run-id <new-run-id>          # default: xp_full_rerun_<shard>_<timestamp>
#   --route-runtime ROUTE_ON|ROUTE_OFF
#   --supersede-source 1           # mark source shard SUPERSEDED before rerun
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E="$ROOT/e2e"
GEN="$E2E/cross-product/generated"

SOURCE_RUN_ID=""
SHARD=""
ROUTE_PROCESSING=""
ROUTE_RUNTIME=""
NEW_RUN_ID=""
SUPERSEDE_SOURCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-run-id) SOURCE_RUN_ID="$2"; shift 2 ;;
    --shard) SHARD="$2"; shift 2 ;;
    --route-processing)
      ROUTE_PROCESSING="$2"
      case "$2" in
        on|true|ON) ROUTE_RUNTIME="ROUTE_ON" ;;
        off|false|OFF) ROUTE_RUNTIME="ROUTE_OFF" ;;
        *) echo "route-processing must be on|off" >&2; exit 2 ;;
      esac
      shift 2
      ;;
    --route-runtime) ROUTE_RUNTIME="$2"; shift 2 ;;
    --run-id) NEW_RUN_ID="$2"; shift 2 ;;
    --supersede-source) SUPERSEDE_SOURCE="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$SOURCE_RUN_ID" && -n "$SHARD" ]] || {
  echo "Usage: $0 --source-run-id ID --shard xp-normal-000 --route-processing on" >&2
  exit 2
}
ROUTE_RUNTIME="${ROUTE_RUNTIME:-ROUTE_ON}"
if [[ "$ROUTE_RUNTIME" == "ROUTE_ON" ]]; then
  export GDC_ROUTE_PROCESSING_ENABLED=true
else
  export GDC_ROUTE_PROCESSING_ENABLED=false
fi
NEW_RUN_ID="${NEW_RUN_ID:-xp_full_rerun_${SHARD}_$(date -u +%Y%m%d_%H%M%S)}"

# Refuse residual filters — full shard only.
if [[ -n "${GDC_XP_COMBINATION_IDS:-}" || -n "${GDC_XP_LIMIT:-}" ]]; then
  echo "ERROR: full shard rerun refuses residual filters" >&2
  exit 1
fi
unset GDC_XP_COMBINATION_IDS GDC_XP_LIMIT GDC_XP_EXECUTION_SURFACE || true

EXPECTED="$(python3 - <<PY
import json
plan=json.load(open("$GEN/shard-plan.json"))
for s in plan["shards"]:
    if s["shard_id"]=="$SHARD":
        print(len(s["combination_ids"]))
        break
else:
    raise SystemExit("shard not found: $SHARD")
PY
)"
echo "Full shard rerun: source=$SOURCE_RUN_ID shard=$SHARD expected=$EXPECTED new_run=$NEW_RUN_ID route=$ROUTE_RUNTIME"

if [[ "$SUPERSEDE_SOURCE" == "1" ]]; then
  "$E2E/cross-product/supersede-shard-results.sh" \
    --run-id "$SOURCE_RUN_ID" \
    --shard "$SHARD" \
    --route-runtime "$ROUTE_RUNTIME" \
    --reason "Full shard re-run with fixed harness; original results untrusted" \
    --replacement-run-id "$NEW_RUN_ID"
fi

export GDC_E2E_RUN_ID="$NEW_RUN_ID"
export GDC_XP_ROUTE_RUNTIME="$ROUTE_RUNTIME"
export GDC_XP_SHARD_FILTER="$SHARD"
export GDC_XP_CONTINUE=0
export PLAYWRIGHT_API_BASE_URL="${PLAYWRIGHT_API_BASE_URL:-http://127.0.0.1:18000}"
export PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:4173}"

# Record linkage on the new run.
mkdir -p "$E2E/reports/$NEW_RUN_ID"
python3 - <<PY
import json, datetime
json.dump({
  "run_id": "$NEW_RUN_ID",
  "kind": "full_shard_rerun",
  "source_run_id": "$SOURCE_RUN_ID",
  "shard_id": "$SHARD",
  "route_runtime": "$ROUTE_RUNTIME",
  "expected_combinations": int("$EXPECTED"),
  "started_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
}, open("$E2E/reports/$NEW_RUN_ID/rerun-linkage.json", "w"), indent=2)
PY

"$E2E/cross-product/run-all-shards.sh"
RC=$?

ART="${SHARD}-${ROUTE_RUNTIME}"
RESULT="$E2E/reports/$NEW_RUN_ID/$ART/cross-product-results.jsonl"
python3 - <<PY
import json, sys
from collections import Counter
expected=int("$EXPECTED")
path="$RESULT"
if not __import__("os").path.exists(path):
    print("ERROR: missing results", path)
    sys.exit(1)
rows=[json.loads(l) for l in open(path) if l.strip()]
ids=set(r.get("combination_id") for r in rows if r.get("combination_id"))
c=Counter(r.get("status") for r in rows)
hv=set(r.get("harness_version") for r in rows if r.get("harness_version"))
summary={
  "new_run_id": "$NEW_RUN_ID",
  "shard": "$SHARD",
  "expected": expected,
  "executed_rows": len(rows),
  "executed_unique": len(ids),
  "by_status": dict(c),
  "harness_versions": sorted(x for x in hv if x),
  "complete": len(ids)==expected and len(rows)>=expected,
}
print(json.dumps(summary, indent=2))
json.dump(summary, open("$E2E/reports/$NEW_RUN_ID/$ART/full-rerun-summary.json", "w"), indent=2)
if not summary["complete"]:
    sys.exit(2)
if len(hv) != 1:
    print("ERROR: harness version missing or mixed")
    sys.exit(3)
PY

# Link replacement harness hash back onto source superseded.json when present.
SRC_SUP="$E2E/reports/$SOURCE_RUN_ID/$ART/superseded.json"
if [[ -f "$SRC_SUP" ]]; then
  python3 - <<PY
import json
sup=json.load(open("$SRC_SUP"))
rows=[json.loads(l) for l in open("$RESULT") if l.strip()]
hv=next((r.get("harness_version") for r in rows if r.get("harness_version")), None)
sup["replacement_run_id"]="$NEW_RUN_ID"
sup["replacement_harness_hash"]=hv
json.dump(sup, open("$SRC_SUP","w"), indent=2)
print("updated", "$SRC_SUP")
PY
fi

exit $RC
