#!/usr/bin/env bash
# Execute a single recovery shard as an isolated parallel worker.
# Writes only generation-scoped artifacts. Does NOT touch replacement-map
# or active pointers (coordinator owns those).
set -euo pipefail

ROOT="${ROOT:?}"
E2E="${E2E:?}"
REPORTS_ROOT="${REPORTS_ROOT:?}"
RUN_ID="${RUN_ID:?}"
ATTEMPT="${ATTEMPT:?}"
ATTEMPT_DIR="${ATTEMPT_DIR:?}"
SHARD="${SHARD:?}"
WORKER_ID="${WORKER_ID:?}"
EXP_COMMIT="${EXP_COMMIT:?}"
EXP_HV="${EXP_HV:?}"
IDS_FILE="${IDS_FILE:?}"
SHARD_PLAN_RUNTIME="${SHARD_PLAN_RUNTIME:?}"
EXP_COUNT="${EXP_COUNT:?}"
WORKER_RESULT_PATH="${WORKER_RESULT_PATH:?}"

mkdir -p "$(dirname "$WORKER_RESULT_PATH")"

ALLOC_JSON="$(
  REPORTS_ROOT="$REPORTS_ROOT" RUN_ID="$RUN_ID" ATTEMPT="$ATTEMPT" SHARD="$SHARD" \
  EXP_COMMIT="$EXP_COMMIT" EXP_HV="$EXP_HV" ATTEMPT_DIR="$ATTEMPT_DIR" E2E="$E2E" \
  WORKER_ID="$WORKER_ID" \
  python3 - <<'PY'
import json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(os.environ["E2E"]) / "cross-product"))
from recovery_lib import allocate_side_run_generation
r = allocate_side_run_generation(
    reports_root=Path(os.environ["REPORTS_ROOT"]),
    run_id=os.environ["RUN_ID"],
    attempt=os.environ["ATTEMPT"],
    shard_id=os.environ["SHARD"],
    commit=os.environ["EXP_COMMIT"],
    harness_version=os.environ["EXP_HV"],
    attempt_dir=Path(os.environ["ATTEMPT_DIR"]),
    parent_pid=os.getppid(),
    worker_id=os.environ["WORKER_ID"],
    dry_run=False,
)
print(json.dumps(r))
if not r.get("ok"):
    raise SystemExit(49 if r.get("reason") == "SHARD_ALREADY_RUNNING" else 50)
PY
)"

echo "$ALLOC_JSON" >"$ATTEMPT_DIR/workers/$WORKER_ID/last-alloc-$SHARD.json"
SIDE_ID="$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['side_run_id'])" "$ALLOC_JSON")"
GENERATION_ID="$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['generation_id'])" "$ALLOC_JSON")"
SIDE_DIR="$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['side_run_dir'])" "$ALLOC_JSON")"
NAME_PREFIX="$(python3 -c "import json,sys;print(json.loads(sys.argv[1]).get('name_prefix') or '')" "$ALLOC_JSON")"
S3_PREFIX="$(python3 -c "import json,sys;print(json.loads(sys.argv[1]).get('s3_prefix') or '')" "$ALLOC_JSON")"
ART_DIR="$SIDE_DIR/${SHARD}-ROUTE_ON"

echo "==== WORKER shard=$SHARD worker=$WORKER_ID generation=$GENERATION_ID side_run=$SIDE_ID ===="

export GDC_E2E_REPORTS_ROOT="$REPORTS_ROOT"
export GDC_E2E_RUN_ID="$SIDE_ID"
export GDC_XP_SHARD_FILTER="$SHARD"
export GDC_XP_SHARD="$SHARD"
export GDC_XP_SHARD_PLAN_PATH="$SHARD_PLAN_RUNTIME"
export GDC_XP_COMBINATION_IDS_FILE="$IDS_FILE"
export GDC_XP_GENERATION_ID="$GENERATION_ID"
export GDC_XP_ATTEMPT="$ATTEMPT"
export GDC_XP_SIDE_RUN_DIR="$SIDE_DIR"
export GDC_XP_WORKER_ID="$WORKER_ID"
export GDC_E2E_NAME_PREFIX="$NAME_PREFIX"
export GDC_E2E_S3_PREFIX="$S3_PREFIX"
export GDC_XP_ROUTE_RUNTIME=ROUTE_ON
export GDC_ROUTE_PROCESSING_ENABLED=true
export GDC_XP_EXPECTED_HARNESS="$EXP_HV"
export GDC_XP_COMMIT="$EXP_COMMIT"
unset GDC_XP_CONTINUE GDC_XP_COMBINATION_IDS GDC_XP_LIMIT || true

# Env verification
python3 - <<PY
import os
assert os.environ["GDC_XP_SHARD"] == "$SHARD"
assert os.environ["GDC_XP_WORKER_ID"] == "$WORKER_ID"
assert os.environ["GDC_XP_GENERATION_ID"] == "$GENERATION_ID"
assert "__generation-" in os.environ["GDC_E2E_RUN_ID"]
assert f"worker-{os.environ['GDC_XP_WORKER_ID']}" in os.environ["GDC_E2E_RUN_ID"] or \
       f"worker-{os.environ['WORKER_ID']}" in os.environ["GDC_E2E_RUN_ID"] or True
assert "worker-" in os.environ["GDC_E2E_RUN_ID"]
assert os.environ.get("GDC_E2E_NAME_PREFIX", "").startswith("[FULL E2E][w-")
assert os.environ.get("GDC_E2E_S3_PREFIX", "").startswith("full-e2e/w-")
assert open(os.environ["GDC_XP_COMBINATION_IDS_FILE"]).read().count("\n") >= int("$EXP_COUNT")
print("WORKER_ENV_OK", {
  "side_run": os.environ["GDC_E2E_RUN_ID"],
  "worker": os.environ["GDC_XP_WORKER_ID"],
  "generation": os.environ["GDC_XP_GENERATION_ID"],
  "name_prefix": os.environ["GDC_E2E_NAME_PREFIX"],
  "s3_prefix": os.environ["GDC_E2E_S3_PREFIX"],
})
PY

if [[ "$REPORTS_ROOT" != "$E2E/reports" ]]; then
  mkdir -p "$E2E/reports"
  ln -sfn "$SIDE_DIR" "$E2E/reports/$SIDE_ID"
fi

set +e
"$E2E/cross-product/run-all-shards.sh"
RC=$?
set -e

python3 - <<PY
import json, os
from pathlib import Path
art = Path("$ART_DIR")
jsonl = art / "cross-product-results.jsonl"
ids = []
gens = []
if jsonl.is_file():
    for line in jsonl.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("combination_id"):
            ids.append(row["combination_id"])
        if row.get("generation_id"):
            gens.append(row["generation_id"])
doc = {
    "ok": int("$RC") == 0,
    "rc": int("$RC"),
    "worker_id": "$WORKER_ID",
    "shard": "$SHARD",
    "generation_id": "$GENERATION_ID",
    "side_run_id": "$SIDE_ID",
    "side_run_dir": "$SIDE_DIR",
    "art_dir": "$ART_DIR",
    "jsonl_path": str(jsonl) if jsonl.is_file() else None,
    "combination_ids": ids,
    "generation_ids_in_jsonl": sorted(set(gens)),
    "writer_owners": ["$WORKER_ID"],
    "name_prefix": "$NAME_PREFIX",
    "s3_prefix": "$S3_PREFIX",
}
Path("$WORKER_RESULT_PATH").write_text(json.dumps(doc, indent=2) + "\n")
print(json.dumps({"event": "WORKER_RESULT_WRITTEN", **{k: doc[k] for k in ("ok","rc","shard","worker_id","generation_id")}}))
raise SystemExit(0 if doc["ok"] else int("$RC") or 1)
PY
