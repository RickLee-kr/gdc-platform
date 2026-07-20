#!/usr/bin/env bash
# Isolate a completed shard as SUPERSEDED evidence (do not delete).
# Usage:
#   ./e2e/cross-product/supersede-shard-results.sh \
#     --run-id xp_full_on_20260717_101601 \
#     --shard xp-normal-000 \
#     --route-runtime ROUTE_ON \
#     --reason "old harness: collector correlation + delivery/collector gate defects" \
#     --replacement-run-id xp_full_on_shard0_rerun_...
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E="$ROOT/e2e"

RUN_ID=""
SHARD=""
ROUTE_RUNTIME="ROUTE_ON"
REASON=""
REPLACEMENT_RUN_ID=""
DEFECTS='["webhook_bearer_path","multi_route_source_settings","collector_correlation","delivery_success_collector_zero_pass"]'

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id) RUN_ID="$2"; shift 2 ;;
    --shard) SHARD="$2"; shift 2 ;;
    --route-runtime) ROUTE_RUNTIME="$2"; shift 2 ;;
    --reason) REASON="$2"; shift 2 ;;
    --replacement-run-id) REPLACEMENT_RUN_ID="$2"; shift 2 ;;
    --defects-json) DEFECTS="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$RUN_ID" && -n "$SHARD" && -n "$REASON" ]] || {
  echo "Usage: $0 --run-id ID --shard xp-normal-000 --reason TEXT [--replacement-run-id ID]" >&2
  exit 2
}

ART="${SHARD}-${ROUTE_RUNTIME}"
SRC="$E2E/reports/$RUN_ID/$ART"
[[ -d "$SRC" ]] || { echo "Missing shard dir: $SRC" >&2; exit 1; }

if [[ -f "$SRC/superseded.json" ]]; then
  echo "Already superseded: $SRC/superseded.json"
  cat "$SRC/superseded.json"
  exit 0
fi

ORIGINAL="$SRC/original"
mkdir -p "$ORIGINAL"
shopt -s nullglob
for item in "$SRC"/*; do
  base="$(basename "$item")"
  [[ "$base" == "original" || "$base" == "rerun" || "$base" == "superseded.json" ]] && continue
  mv "$item" "$ORIGINAL/"
done
shopt -u nullglob

ORIGINAL_HARNESS=""
if [[ -f "$ORIGINAL/harness-manifest.json" ]]; then
  ORIGINAL_HARNESS="$(python3 -c "import json;print(json.load(open('$ORIGINAL/harness-manifest.json')).get('harness_version',''))")"
elif [[ -f "$ORIGINAL/cross-product-results.jsonl" ]]; then
  ORIGINAL_HARNESS="$(python3 -c "import json;print(json.loads(open('$ORIGINAL/cross-product-results.jsonl').readline()).get('harness_version',''))" 2>/dev/null || true)"
fi

export RUN_ID_ENV="$RUN_ID"
export SHARD_ENV="$SHARD"
export ROUTE_RUNTIME_ENV="$ROUTE_RUNTIME"
export REASON_ENV="$REASON"
export DEFECTS_ENV="$DEFECTS"
export ORIGINAL_HARNESS_ENV="$ORIGINAL_HARNESS"
export REPLACEMENT_RUN_ID_ENV="$REPLACEMENT_RUN_ID"
export SRC_ENV="$SRC"

python3 - <<'PY'
import json, datetime, os
from pathlib import Path
from collections import Counter

src = Path(os.environ["SRC_ENV"])
original = src / "original"
results = original / "cross-product-results.jsonl"
man = original / "shard-manifest.json"
executed = 0
by_status = {}
expected = 1050
if man.exists():
  md = json.loads(man.read_text())
  expected = int(md.get("expected_combinations") or expected)
if results.exists():
  rows = [json.loads(l) for l in results.read_text().splitlines() if l.strip()]
  executed = len(rows)
  by_status = dict(Counter(r.get("status") for r in rows))
  if not os.environ.get("ORIGINAL_HARNESS_ENV"):
    # Prefer explicit missing → legacy/unversioned
    hv = rows[0].get("harness_version") if rows else None
    os.environ["ORIGINAL_HARNESS_ENV"] = hv or "legacy/unversioned"

orig_hv = os.environ.get("ORIGINAL_HARNESS_ENV") or "legacy/unversioned"
doc = {
  "status": "SUPERSEDED",
  "source_run_id": os.environ["RUN_ID_ENV"],
  "original_run_id": os.environ["RUN_ID_ENV"],
  "shard_id": os.environ["SHARD_ENV"],
  "route_mode": os.environ["ROUTE_RUNTIME_ENV"],
  "route_runtime": os.environ["ROUTE_RUNTIME_ENV"],
  "expected_combination_count": expected,
  "executed_count": executed,
  "by_status": by_status,
  "replacement_target_count": expected,
  "superseded_reason": os.environ.get("REASON_ENV") or "",
  "reason": os.environ.get("REASON_ENV") or "",
  "harness_defects": json.loads(os.environ.get("DEFECTS_ENV") or "[]"),
  "original_harness_hash": orig_hv,
  "replacement_run_id": os.environ.get("REPLACEMENT_RUN_ID_ENV") or None,
  "replacement_harness_hash": None,
  "merge_exclusion_status": "excluded_from_final_merge",
  "excluded_from_final_merge": True,
  "fail_only_rerun_forbidden": True,
  "superseded_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
  "original_path": "original/",
  "rerun_path": "rerun/",
  "cleanup_evidence_preserved": True,
  "results_deleted": False,
}
out = src / "superseded.json"
json.dump(doc, open(out, "w"), indent=2)
print(json.dumps(doc, indent=2))
PY

echo "SUPERSEDED $SRC (evidence preserved under original/)"
