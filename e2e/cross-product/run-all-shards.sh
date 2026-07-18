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
if [[ -n "${GDC_XP_COMBINATION_IDS:-}" || -n "${GDC_XP_LIMIT:-}" ]]; then
  echo "ERROR: full shard run refuses residual filters:" >&2
  echo "  GDC_XP_COMBINATION_IDS=${GDC_XP_COMBINATION_IDS:-"(unset)"}" >&2
  echo "  GDC_XP_LIMIT=${GDC_XP_LIMIT:-"(unset)"}" >&2
  echo "Unset both before run-all-shards.sh, or use a preflight/limited command." >&2
  exit 1
fi
unset GDC_XP_EXECUTION_SURFACE


COMMIT="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
MANIFEST_HASH="$(python3 -c "import json;print(json.load(open('$GEN/generation-summary.json'))['manifest_hash'])")"
RULES_HASH="$(python3 -c "import json;print(json.load(open('$GEN/generation-summary.json'))['applicability_rules_hash'])")"
AXES_HASH="$(python3 -c "import json;print(json.load(open('$GEN/generation-summary.json'))['axes_hash'])")"

# Content hashes for the executing harness (python-only so preflight works without npx on PATH).
HARNESS_JSON="$(
XP_ROOT="$E2E/cross-product" E2E_ROOT="$E2E" GEN_PATH="$GEN" COMMIT_ENV="$COMMIT" python3 - <<'PY'
import hashlib, json, os
from pathlib import Path
xp = Path(os.environ["XP_ROOT"])
e2e = Path(os.environ["E2E_ROOT"])
gen = Path(os.environ["GEN_PATH"])
def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()
executor_hash = sha(xp / "cross-product-executor.ts")
driver_hash = sha(e2e / "framework/data-relay-driver.ts")
spec_hash = sha(xp / "matrix/cross-product.spec.ts")
oracle_hash = sha(xp / "oracle.ts")
fixture_hash = sha(xp / "fixtures/composite-chain-fixture.ts")
summary = json.loads((gen / "generation-summary.json").read_text())
manifest_hash = summary.get("manifest_hash", "")
rules_hash = summary.get("applicability_rules_hash", "")
axes_hash = summary.get("axes_hash", "")
commit = os.environ.get("COMMIT_ENV") or "unknown"
harness_version = hashlib.sha256("\n".join([
    executor_hash, driver_hash, spec_hash, oracle_hash, fixture_hash,
    commit, manifest_hash, rules_hash, axes_hash,
]).encode()).hexdigest()
print(json.dumps({
    "executor_hash": executor_hash,
    "driver_hash": driver_hash,
    "spec_hash": spec_hash,
    "oracle_hash": oracle_hash,
    "fixture_hash": fixture_hash,
    "harness_version": harness_version,
    "manifest_hash": manifest_hash,
    "applicability_rules_hash": rules_hash,
    "axes_hash": axes_hash,
}))
PY
)"
EXECUTOR_HASH="$(python3 -c "import json,sys;print(json.load(sys.stdin)['executor_hash'])" <<<"$HARNESS_JSON")"
DRIVER_HASH="$(python3 -c "import json,sys;print(json.load(sys.stdin)['driver_hash'])" <<<"$HARNESS_JSON")"
SPEC_HASH="$(python3 -c "import json,sys;print(json.load(sys.stdin)['spec_hash'])" <<<"$HARNESS_JSON")"
ORACLE_HASH="$(python3 -c "import json,sys;print(json.load(sys.stdin)['oracle_hash'])" <<<"$HARNESS_JSON")"
FIXTURE_HASH="$(python3 -c "import json,sys;print(json.load(sys.stdin)['fixture_hash'])" <<<"$HARNESS_JSON")"
HARNESS_VERSION="$(python3 -c "import json,sys;print(json.load(sys.stdin)['harness_version'])" <<<"$HARNESS_JSON")"

META_DIR="$E2E/reports/$RUN_ID"
mkdir -p "$META_DIR"
python3 - <<PY
import json, datetime
doc = {
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
  "started_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
}
json.dump(doc, open("$META_DIR/run-metadata.json", "w"), indent=2)
json.dump(doc, open("$META_DIR/harness-manifest.json", "w"), indent=2)
print(json.dumps({"harness_version": "$HARNESS_VERSION", "commit": "$COMMIT"}, indent=2))
PY

mapfile -t SHARDS < <(GEN_PATH="$GEN" python3 - <<'PY'
import json, os
plan = json.load(open(os.environ["GEN_PATH"] + "/shard-plan.json"))
filt = os.environ.get("GDC_XP_SHARD_FILTER", "").strip()
for s in plan["shards"]:
    sid = s["shard_id"]
    if filt and sid != filt:
        continue
    print(sid)
PY
)

echo "RUN_ID=$RUN_ID route=$ROUTE_RUNTIME shards=${#SHARDS[@]} commit=$COMMIT"

cd "$E2E"
FAILED=0
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
  XP_ROOT="$E2E/cross-product" E2E_ROOT="$E2E" GEN_PATH="$GEN" COMMIT_ENV="$COMMIT" python3 - <<'PY'
import hashlib, json, os
from pathlib import Path
xp = Path(os.environ["XP_ROOT"])
e2e = Path(os.environ["E2E_ROOT"])
gen = Path(os.environ["GEN_PATH"])
def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()
executor_hash = sha(xp / "cross-product-executor.ts")
driver_hash = sha(e2e / "framework/data-relay-driver.ts")
spec_hash = sha(xp / "matrix/cross-product.spec.ts")
oracle_hash = sha(xp / "oracle.ts")
fixture_hash = sha(xp / "fixtures/composite-chain-fixture.ts")
summary = json.loads((gen / "generation-summary.json").read_text())
manifest_hash = summary.get("manifest_hash", "")
rules_hash = summary.get("applicability_rules_hash", "")
axes_hash = summary.get("axes_hash", "")
commit = os.environ.get("COMMIT_ENV") or "unknown"
harness_version = hashlib.sha256("\n".join([
    executor_hash, driver_hash, spec_hash, oracle_hash, fixture_hash,
    commit, manifest_hash, rules_hash, axes_hash,
]).encode()).hexdigest()
print(json.dumps({
    "executor_hash": executor_hash,
    "driver_hash": driver_hash,
    "spec_hash": spec_hash,
    "oracle_hash": oracle_hash,
    "fixture_hash": fixture_hash,
    "harness_version": harness_version,
}))
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
    echo "ERROR: harness_version mismatch before shard=$shard" >&2
    echo "  computed=$HARNESS_VERSION" >&2
    echo "  expected=$GDC_XP_EXPECTED_HARNESS" >&2
    FAILED=$((FAILED + 1))
    mkdir -p "$META_DIR/$ART_DIR"
    echo '{"status":"FAIL","reason":"harness_version_mismatch"}' >"$META_DIR/$ART_DIR/shard-preflight-fail.json"
    continue
  fi
  EXPECTED_COUNT="$(python3 - <<PY
import json
plan=json.load(open("$GEN/shard-plan.json"))
for s in plan["shards"]:
    if s["shard_id"]=="$shard":
        print(len(s["combination_ids"]))
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
  if [[ $RC -ne 0 ]]; then
    FAILED=$((FAILED + 1))
    echo "FAIL shard=$shard rc=$RC — continuing remaining shards"
  else
    echo "PASS shard=$shard"
  fi
done

python3 - <<PY
import json
from pathlib import Path
meta = json.load(open("$META_DIR/run-metadata.json"))
meta["ended_at"] = __import__("datetime").datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
meta["failed_shards"] = $FAILED
json.dump(meta, open("$META_DIR/run-metadata.json", "w"), indent=2)
print(json.dumps(meta, indent=2))
PY

echo "DONE run=$RUN_ID failed_shards=$FAILED"
exit $FAILED
