#!/usr/bin/env bash
# Re-run FAIL/BLOCKED/GAP combination_ids from a shard artifact dir.
# Usage:
#   GDC_E2E_RUN_ID=xp_full_on_... GDC_XP_SHARD=xp-normal-000 \
#     ./e2e/cross-product/rerun-failed-combinations.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E="$ROOT/e2e"
RUN_ID="${GDC_E2E_RUN_ID:?GDC_E2E_RUN_ID required}"
SHARD="${GDC_XP_SHARD:?GDC_XP_SHARD required}"
ROUTE_RUNTIME="${GDC_XP_ROUTE_RUNTIME:-ROUTE_ON}"
ART_DIR="${GDC_E2E_SHARD_ARTIFACT_DIR:-${SHARD}-${ROUTE_RUNTIME}}"
RESULT="$E2E/reports/$RUN_ID/$ART_DIR/cross-product-results.jsonl"

if [[ ! -f "$RESULT" ]]; then
  echo "No results file: $RESULT" >&2
  exit 1
fi

IDS="$(python3 - <<PY
import json
ids=[]
for line in open("$RESULT"):
    if not line.strip():
        continue
    r=json.loads(line)
    if r.get("status") in ("FAIL","BLOCKED","GAP"):
        cid=r.get("combination_id")
        if cid:
            ids.append(cid)
# unique preserve order
seen=set(); out=[]
for i in ids:
    if i in seen: continue
    seen.add(i); out.append(i)
print(",".join(out))
PY
)"

if [[ -z "$IDS" ]]; then
  echo "No FAIL/BLOCKED/GAP rows in $RESULT"
  exit 0
fi

COUNT="$(python3 - <<PY
print(len("$IDS".split(",")))
PY
)"
echo "Re-running $COUNT failed combination_ids for shard=$SHARD run=$RUN_ID"

# Explicit limited re-run — filters are intentional (not a full shard run).
export GDC_XP_COMBINATION_IDS="$IDS"
export GDC_XP_SHARD="$SHARD"
export GDC_E2E_RUN_ID="$RUN_ID"
export GDC_XP_ROUTE_RUNTIME="$ROUTE_RUNTIME"
export GDC_E2E_SHARD_ARTIFACT_DIR="$ART_DIR"
export PLAYWRIGHT_API_BASE_URL="${PLAYWRIGHT_API_BASE_URL:-http://127.0.0.1:18000}"
export PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:4173}"
unset GDC_XP_LIMIT || true

cd "$E2E"
npx playwright test -c playwright.config.ts --project=cross-product --reporter=line 2>&1 | tee "$E2E/reports/$RUN_ID/$ART_DIR/rerun-failed.log"
echo "Rerun finished. Merge will resolve same-commit status conflicts by latest finishedAt."
