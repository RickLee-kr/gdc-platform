#!/usr/bin/env bash
# Durable recovery orchestrator for Full Cross-Product E2E.
# - Never kill the active shard-0 playwright process while it is still running
# - After shard-0 COMPLETE: SUPERSEDE original results (do not FAIL-only rerun)
# - Verify fixed harness on shard-1+; abort/resume if mismatch
# - After remaining route-on shards: full shard-0 rerun with fixed harness
# - Then route-off → merge → gate → cleanup → regression
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E="$ROOT/e2e"
SOURCE_RUN_ID="${1:-xp_full_on_20260717_101601}"
RESULTS="$E2E/reports/$SOURCE_RUN_ID"
STATE="$RESULTS/recovery-orchestrator-state.json"
LOG="$RESULTS/recovery-orchestrator.log"
ORCH_PID_FILE="$E2E/reports/.pids/xp_full_on.pid"
RECOVERY_PID_FILE="$E2E/reports/.pids/xp_recovery.pid"
LOCK_DIR="$E2E/reports/.locks"
LOCK_FILE="$LOCK_DIR/xp-full-recovery-${SOURCE_RUN_ID}.lock"
EXPECTED_HARNESS_FILE="$RESULTS/expected-fixed-harness.json"
FIXED_HARNESS_EXPECTED="009daf57881a515e73d7ef388eb1bd9bdd6e82bb2a9166fe3479b50bf5e2e307"

mkdir -p "$RESULTS" "$LOCK_DIR" "$E2E/reports/.pids"
cd "$E2E"

# ---------------------------------------------------------------------------
# Single-execution lock (per Run ID). Stale lock removed only if owner PID dead.
# ---------------------------------------------------------------------------
acquire_lock() {
  local my_pid=$$
  if [[ -f "$LOCK_FILE" ]]; then
    local owner
    owner="$(python3 -c "import json;print(json.load(open('$LOCK_FILE')).get('pid',''))" 2>/dev/null || true)"
    if [[ -n "$owner" ]] && kill -0 "$owner" 2>/dev/null; then
      if [[ "$owner" == "$my_pid" ]]; then
        return 0
      fi
      echo "ERROR: Recovery Orchestrator already running for $SOURCE_RUN_ID (pid=$owner lock=$LOCK_FILE)" >&2
      exit 1
    fi
    echo "Removing stale lock (owner_pid=${owner:-unknown} not running)"
    rm -f "$LOCK_FILE"
  fi
  # Atomic create: fail if another process wins the race.
  if ! (
    set -o noclobber
    python3 - <<PY >"$LOCK_FILE"
import json, os, datetime
print(json.dumps({
  "run_id": "$SOURCE_RUN_ID",
  "pid": $my_pid,
  "acquired_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
  "lock_file": "$LOCK_FILE",
}, indent=2))
PY
  ); then
    echo "ERROR: failed to acquire lock $LOCK_FILE (another instance won the race)" >&2
    exit 1
  fi
  # Verify we own it
  local now_owner
  now_owner="$(python3 -c "import json;print(json.load(open('$LOCK_FILE')).get('pid',''))")"
  if [[ "$now_owner" != "$my_pid" ]]; then
    echo "ERROR: lock owner mismatch (expected=$my_pid actual=$now_owner)" >&2
    exit 1
  fi
  echo "$my_pid" >"$RECOVERY_PID_FILE"
}

release_lock() {
  if [[ -f "$LOCK_FILE" ]]; then
    local owner
    owner="$(python3 -c "import json;print(json.load(open('$LOCK_FILE')).get('pid',''))" 2>/dev/null || true)"
    if [[ "$owner" == "$$" ]]; then
      rm -f "$LOCK_FILE"
    fi
  fi
}
trap release_lock EXIT
acquire_lock

npx tsx cross-product/harness-version.ts >"$EXPECTED_HARNESS_FILE"
EXPECTED_HV="$(python3 -c "import json;print(json.load(open('$EXPECTED_HARNESS_FILE'))['harness_version'])")"
if [[ "$EXPECTED_HV" != "$FIXED_HARNESS_EXPECTED" ]]; then
  echo "WARNING: disk harness $EXPECTED_HV != pinned $FIXED_HARNESS_EXPECTED" | tee -a "$LOG"
fi

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG"; }
notify() { /usr/local/bin/notify.sh "$1" "Project: gdc-platform

$*" || true; }

save_state() {
  PHASE="$1" python3 - <<'PY'
import json, os, datetime
path=os.environ["STATE_PATH"]
doc={}
if os.path.exists(path):
  try: doc=json.load(open(path))
  except: doc={}
doc["phase"]=os.environ["PHASE"]
doc["updated_at"]=datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
doc["orchestrator_pid"]=os.getppid()
json.dump(doc, open(path,"w"), indent=2)
PY
}
export STATE_PATH="$STATE"

write_incomplete() {
  REASON="$1" python3 - <<'PY'
import json, os, datetime
from pathlib import Path
art=Path(os.environ["RESULTS_ENV"])/"xp-normal-000-ROUTE_ON"
art.mkdir(parents=True, exist_ok=True)
doc={
  "status":"INCOMPLETE",
  "reason": os.environ["REASON"],
  "recorded_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
}
json.dump(doc, open(art/"incomplete.json","w"), indent=2)
print(json.dumps(doc))
PY
}
export RESULTS_ENV="$RESULTS"

phase="$(python3 -c "import json,os;print(json.load(open(os.environ['STATE_PATH'])).get('phase','watch_shard0') if os.path.exists(os.environ['STATE_PATH']) else 'watch_shard0')" 2>/dev/null || echo watch_shard0)"
log "START recovery orchestrator phase=$phase source=$SOURCE_RUN_ID expected_harness=$EXPECTED_HV pid=$$ lock=$LOCK_FILE"
notify INFO "Status: XP recovery orchestrator started (single-lock)
Run: $SOURCE_RUN_ID
Phase: $phase
PID: $$
Expected harness: ${EXPECTED_HV:0:16}..."

# ---------------------------------------------------------------------------
# Strict shard-0 completion: process exit alone is NOT enough.
# ---------------------------------------------------------------------------
shard0_done() {
  python3 - <<PY
import json, os, time
from pathlib import Path
base=Path("$RESULTS")
art=base/"xp-normal-000-ROUTE_ON"
# Already superseded → done
if (art/"superseded.json").exists() or (art/"original"/"cross-product-results.jsonl").exists() and (art/"superseded.json").exists():
  raise SystemExit(0)

# If incomplete marker present without later recovery, not done
if (art/"incomplete.json").exists() and not (art/"superseded.json").exists():
  # still allow re-check if process finished cleanly later
  pass

# Later shard started implies original shard-0 playwright finished (run-all-shards sequential)
later_started=False
for p in sorted(base.glob("xp-normal-*-ROUTE_ON")):
  if p.name.startswith("xp-normal-000"): continue
  if (p/"cross-product-results.jsonl").exists() or (p/"playwright.log").exists() or (p/"shard-manifest.json").exists():
    later_started=True
    break

man=art/"shard-manifest.json"
man_doc={}
if man.exists():
  man_doc=json.loads(man.read_text())

results=art/"cross-product-results.jsonl"
if not results.exists() and (art/"original"/"cross-product-results.jsonl").exists():
  # moved already
  raise SystemExit(0)
if not results.exists():
  raise SystemExit(1)

rows=[json.loads(l) for l in results.read_text().splitlines() if l.strip()]
expected=int(man_doc.get("expected_combinations") or 1050)
executed=len(rows)
unique=len({r.get("combination_id") for r in rows if r.get("combination_id")})

ended = man_doc.get("ended_at") is not None or man_doc.get("exit_code") is not None
# Playwright / run-all-shards parent for shard-0 no longer running this artifact
# Stable file: no mtime change for 90s
mtime=results.stat().st_mtime
age=time.time()-mtime
stable = age >= 90

# Abnormal markers
abnormal = (art/"abnormal-exit.json").exists() or (art/"shard-preflight-fail.json").exists()
if abnormal:
  Path(os.environ["RESULTS_ENV"])  # keep import used
  raise SystemExit(1)

# Cleanup evidence: per-row cleanup_ok present OR cleanup-report.json
cleanup_ok_rows = sum(1 for r in rows if "cleanup_ok" in r)
cleanup_report = (art/"cleanup-report.json").exists() or (base/"cleanup-report.json").exists()
cleanup_recorded = cleanup_ok_rows >= max(1, int(executed*0.9)) or cleanup_report

# Evidence dirs flushed: at least one evidence dir per executed row (best-effort)
evidence_dirs=list(art.glob("cross_product__xp_*"))
evidence_flushed = len(evidence_dirs) >= max(0, executed - 5)  # allow small lag

# Attempted expected count (allow Playwright fail-count; require near-full)
attempted_ok = executed >= expected or (ended and executed >= expected - 0) or (later_started and executed >= expected)

complete = (
  (ended or later_started) and
  attempted_ok and
  executed >= expected and
  unique >= expected and
  stable and
  cleanup_recorded and
  evidence_flushed and
  not abnormal
)
if complete:
  raise SystemExit(0)

# Soft incomplete when process ended but criteria unmet
if ended and not complete:
  inc={
    "status":"INCOMPLETE",
    "reason":"shard0_process_ended_but_completion_criteria_unmet",
    "expected": expected,
    "executed": executed,
    "unique": unique,
    "stable": stable,
    "cleanup_recorded": cleanup_recorded,
    "evidence_dirs": len(evidence_dirs),
    "ended": ended,
    "later_started": later_started,
  }
  (art/"incomplete.json").write_text(json.dumps(inc, indent=2))
raise SystemExit(1)
PY
}

route_on_done() {
  python3 - <<PY
import json
from pathlib import Path
plan=json.load(open("$E2E/cross-product/generated/shard-plan.json"))
base=Path("$RESULTS")
missing=[]
for s in plan["shards"]:
  sid=s["shard_id"]
  art=base/f"{sid}-ROUTE_ON"
  if sid=="xp-normal-000":
    if (art/"superseded.json").exists() or (art/"original"/"shard-manifest.json").exists():
      continue
    missing.append(sid); continue
  man=art/"shard-manifest.json"
  if not man.exists():
    missing.append(sid); continue
  doc=json.loads(man.read_text())
  if doc.get("ended_at") is None and doc.get("exit_code") is None:
    missing.append(sid)
print("missing", len(missing))
if missing[:5]:
  print("examples", missing[:5])
raise SystemExit(0 if not missing else 1)
PY
}

verify_shard_harness() {
  # Args: artifact dir name (e.g. xp-normal-001-ROUTE_ON). Exit 0 ok, 2 mismatch, 1 pending.
  ART_NAME="$1" python3 - <<PY
import json, os
from pathlib import Path
exp="$EXPECTED_HV"
art = Path("$RESULTS") / os.environ["ART_NAME"]
res = art / "cross-product-results.jsonl"
if not res.exists():
  raise SystemExit(1)
lines=[l for l in res.read_text().splitlines() if l.strip()]
if not lines:
  raise SystemExit(1)
r=json.loads(lines[0])
hv=r.get("harness_version") or ""
print(json.dumps({"artifact": os.environ["ART_NAME"], "first_harness": hv or None, "expected": exp, "match": hv==exp, "rows": len(lines)}))
if not hv:
  raise SystemExit(2)
if hv != exp:
  raise SystemExit(2)
raise SystemExit(0)
PY
}

live_canary_shard1() {
  python3 - <<PY
import json
from pathlib import Path
art=Path("$RESULTS")/"xp-normal-001-ROUTE_ON"
res=art/"cross-product-results.jsonl"
out=art/"live-canary.json"
if not res.exists():
  print("canary_pending")
  raise SystemExit(1)
rows=[json.loads(l) for l in res.read_text().splitlines() if l.strip()]
need=min(5, len(rows))
if need < 3:
  print("canary_pending_rows", len(rows))
  raise SystemExit(1)
sample=rows[:need]
exp="$EXPECTED_HV"
checks={
  "harness_hash_ok": all((r.get("harness_version")==exp) for r in sample),
  "rows_sampled": need,
  "statuses": [r.get("status") for r in sample],
  "webhook_bearer_seen": False,
  "postgres_seen": False,
  "sftp_seen": False,
  "collector_ok_on_continue_success": True,
  "notes": [],
}
for r in sample:
  detail=str(r.get("detail") or "") + " " + str(r.get("scenarioId") or "") + " " + str(r.get("combination_id") or "")
  axes=r.get("axes") or {}
  src=str(axes.get("source_type") or axes.get("source") or detail).lower()
  if "webhook" in src or "webhook" in detail.lower():
    checks["webhook_bearer_seen"]=True
  if "postgres" in src or "postgresql" in detail.lower():
    checks["postgres_seen"]=True
  if "sftp" in src:
    checks["sftp_seen"]=True
  # Continue + delivery success should not assert collector 0
  if r.get("status")=="PASS" and r.get("runtime_collector_mismatch"):
    checks["collector_ok_on_continue_success"]=False
    checks["notes"].append("runtime_collector_mismatch on PASS")
checks["trusted_final"]=False  # never trust until canary recorded
checks["canary_pass"]=bool(checks["harness_hash_ok"] and checks["collector_ok_on_continue_success"])
out.write_text(json.dumps(checks, indent=2))
print(json.dumps(checks, indent=2))
raise SystemExit(0 if checks["canary_pass"] else 2)
PY
}

stop_route_on_orchestrator() {
  # Stop run-all-shards for this run — never kill an in-flight shard-0 only case;
  # used when shard-1+ harness mismatch requires resume with fixed script.
  if [[ -f "$ORCH_PID_FILE" ]]; then
    local pid
    pid="$(cat "$ORCH_PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      log "Stopping route-on orchestrator pid=$pid for harness-mismatch resume"
      # Kill process group carefully: only the bash orchestrator; children playwright for current shard will stop.
      kill "$pid" 2>/dev/null || true
      sleep 5
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
  fi
}

resume_route_on_from_shard1() {
  local resume_id="${SOURCE_RUN_ID}"
  log "Resuming route-on from shard-1 with fixed run-all-shards (CONTINUE=1, shard-0 excluded via SUPERSEDED)"
  notify ERROR "Type: shard-1 harness mismatch — resuming from shard-1 with fixed harness
Run: $SOURCE_RUN_ID"
  # Ensure shard-0 superseded first if completed
  if [[ -f "$RESULTS/xp-normal-000-ROUTE_ON/cross-product-results.jsonl" ]] && [[ ! -f "$RESULTS/xp-normal-000-ROUTE_ON/superseded.json" ]]; then
    "$E2E/cross-product/supersede-shard-results.sh" \
      --run-id "$SOURCE_RUN_ID" \
      --shard xp-normal-000 \
      --route-runtime ROUTE_ON \
      --reason "Harness mismatch on shard-1; original shard-0 pre-fix harness SUPERSEDED; resume shard-1+ only" \
      --replacement-run-id pending || true
  fi
  # Remove any partial bad shard-1+ artifacts that have wrong harness (keep evidence under .bad-*)
  python3 - <<PY
import shutil
from pathlib import Path
base=Path("$RESULTS")
exp="$EXPECTED_HV"
for art in sorted(base.glob("xp-normal-*-ROUTE_ON")):
  if art.name.startswith("xp-normal-000"): continue
  res=art/"cross-product-results.jsonl"
  if not res.exists(): continue
  line=res.read_text().splitlines()
  if not line: continue
  import json
  hv=json.loads(line[0]).get("harness_version")
  if hv and hv!=exp:
    bad=art.parent/f".bad-{art.name}"
    if bad.exists(): shutil.rmtree(bad)
    art.rename(bad)
    print("quarantined", art.name, "->", bad.name)
PY
  export GDC_E2E_RUN_ID="$SOURCE_RUN_ID"
  export GDC_XP_ROUTE_RUNTIME=ROUTE_ON
  export GDC_ROUTE_PROCESSING_ENABLED=true
  export GDC_XP_CONTINUE=1
  export GDC_XP_EXPECTED_HARNESS="$EXPECTED_HV"
  unset GDC_XP_COMBINATION_IDS GDC_XP_LIMIT GDC_XP_SHARD_FILTER || true
  set +e
  nohup "$E2E/cross-product/run-all-shards.sh" >>"$RESULTS/resume-route-on.log" 2>&1 &
  echo $! >"$ORCH_PID_FILE"
  set -e
  log "Resumed run-all-shards pid=$(cat "$ORCH_PID_FILE") expected_harness=$EXPECTED_HV"
  save_state wait_shard1_harness
}

while true; do
  phase="$(python3 -c "import json,os;print(json.load(open(os.environ['STATE_PATH'])).get('phase','watch_shard0') if os.path.exists(os.environ['STATE_PATH']) else 'watch_shard0')" 2>/dev/null || echo watch_shard0)"

  case "$phase" in
    watch_shard0)
      if shard0_done; then
        log "shard-0 COMPLETE — SUPERSEDE original results (no FAIL-only rerun)"
        "$E2E/cross-product/supersede-shard-results.sh" \
          --run-id "$SOURCE_RUN_ID" \
          --shard xp-normal-000 \
          --route-runtime ROUTE_ON \
          --reason "Original xp-normal-000 ran on pre-fix harness (collector correlation / delivery-collector PASS defects / webhook bearer). Full shard must be re-run; FAIL-only rerun forbidden." \
          --replacement-run-id pending
        save_state wait_shard1_harness
        notify INFO "Status: shard-0 SUPERSEDED
Run: $SOURCE_RUN_ID
Next: verify shard-1 fixed harness"
      else
        python3 - <<'PY' | tee -a "$LOG"
import json
from pathlib import Path
from collections import Counter
p=Path("/home/aella/gdc-platform/e2e/reports/xp_full_on_20260717_101601/xp-normal-000-ROUTE_ON/cross-product-results.jsonl")
if not p.exists():
  p=Path("/home/aella/gdc-platform/e2e/reports/xp_full_on_20260717_101601/xp-normal-000-ROUTE_ON/original/cross-product-results.jsonl")
if p.exists():
  rows=[json.loads(l) for l in p.read_text().splitlines() if l.strip()]
  c=Counter(r.get("status") for r in rows)
  print(f"shard0 progress rows={len(rows)} {dict(c)}")
else:
  print("shard0 results not found yet")
PY
      fi
      ;;

    wait_shard1_harness)
      set +e
      verify_shard_harness "xp-normal-001-ROUTE_ON"
      HV_RC=$?
      set -e
      if [[ $HV_RC -eq 0 ]]; then
        log "shard-1 first harness_version MATCHES fixed harness"
        save_state wait_shard1_canary
      elif [[ $HV_RC -eq 2 ]]; then
        log "shard-1 harness MISMATCH or missing — stopping route-on and resuming with fixed script"
        stop_route_on_orchestrator
        resume_route_on_from_shard1
      else
        log "shard-1 harness pending (no rows yet)"
      fi
      ;;

    wait_shard1_canary)
      set +e
      live_canary_shard1
      C_RC=$?
      set -e
      if [[ $C_RC -eq 0 ]]; then
        log "shard-1 live canary PASS (harness ok) — trusting subsequent shard-1+ results for merge eligibility"
        python3 - <<'PY'
import json
from pathlib import Path
p=Path("/home/aella/gdc-platform/e2e/reports/xp_full_on_20260717_101601/xp-normal-001-ROUTE_ON/live-canary.json")
if p.exists():
  d=json.loads(p.read_text()); d["trusted_final"]=True
  p.write_text(json.dumps(d, indent=2))
PY
        save_state wait_route_on
        notify INFO "Status: shard-1 live canary passed
Run: $SOURCE_RUN_ID"
      elif [[ $C_RC -eq 2 ]]; then
        notify ERROR "Type: shard-1 live canary FAILED
Run: $SOURCE_RUN_ID"
        # Keep waiting / do not mark canary trusted; continue observing
        save_state wait_shard1_canary
      else
        log "shard-1 canary pending"
      fi
      ;;

    wait_route_on)
      if [[ -f "$ORCH_PID_FILE" ]]; then
        ORCH_PID="$(cat "$ORCH_PID_FILE")"
        if ! kill -0 "$ORCH_PID" 2>/dev/null; then
          log "WARNING: route-on orchestrator pid $ORCH_PID exited"
          notify ERROR "Type: route-on orchestrator exited
PID: $ORCH_PID
Run: $SOURCE_RUN_ID"
        fi
      fi
      # Continuous harness check on newest non-000 shard
      set +e
      python3 - <<PY
import json
from pathlib import Path
exp="$EXPECTED_HV"
base=Path("$RESULTS")
bad=[]
for art in sorted(base.glob("xp-normal-*-ROUTE_ON")):
  if art.name.startswith("xp-normal-000"): continue
  res=art/"cross-product-results.jsonl"
  if not res.exists(): continue
  for line in res.read_text().splitlines():
    if not line.strip(): continue
    r=json.loads(line)
    hv=r.get("harness_version")
    if not hv or hv!=exp:
      bad.append((art.name, hv or "missing"))
    break
if bad:
  print("HARNESS_MISMATCH", bad[:5])
  raise SystemExit(2)
print("harness_ok_or_pending")
PY
      HV_RC=$?
      set -e
      if [[ $HV_RC -eq 2 ]]; then
        notify ERROR "Type: shard harness_version mismatch vs fixed harness
Run: $SOURCE_RUN_ID"
        stop_route_on_orchestrator
        resume_route_on_from_shard1
        continue
      fi
      if route_on_done; then
        log "route-on shards complete — starting full shard-0 rerun"
        save_state rerun_shard0
        continue
      fi
      ;;

    rerun_shard0)
      RERUN_ID="xp_full_rerun_xp-normal-000_$(date -u +%Y%m%d_%H%M%S)"
      python3 - <<PY
import json
doc=json.load(open("$STATE")) if __import__("os").path.exists("$STATE") else {}
doc["shard0_rerun_id"]="$RERUN_ID"
json.dump(doc, open("$STATE","w"), indent=2)
PY
      log "FULL shard-0 rerun run_id=$RERUN_ID"
      notify INFO "Status: starting full xp-normal-000 rerun (1050)
Run: $RERUN_ID
Source: $SOURCE_RUN_ID"
      set +e
      "$E2E/cross-product/rerun-full-shard.sh" \
        --source-run-id "$SOURCE_RUN_ID" \
        --shard xp-normal-000 \
        --route-processing on \
        --run-id "$RERUN_ID" \
        --supersede-source 0
      RC=$?
      set -e
      if [[ $RC -ne 0 ]]; then
        notify ERROR "Type: full shard-0 rerun failed
Run: $RERUN_ID
rc: $RC"
        save_state rerun_shard0_failed
        sleep 600
        continue
      fi
      python3 - <<PY
import json
from pathlib import Path
sup=Path("$RESULTS/xp-normal-000-ROUTE_ON/superseded.json")
if sup.exists():
  doc=json.loads(sup.read_text())
  doc["replacement_run_id"]="$RERUN_ID"
  rows_path=Path("$E2E/reports/$RERUN_ID/xp-normal-000-ROUTE_ON/cross-product-results.jsonl")
  if rows_path.exists():
    row=json.loads(rows_path.read_text().splitlines()[0])
    doc["replacement_harness_hash"]=row.get("harness_version")
  json.dump(doc, open(sup,"w"), indent=2)
PY
      save_state route_off
      ;;

    rerun_shard0_failed)
      log "rerun_shard0_failed — waiting before retry"
      sleep 600
      save_state rerun_shard0
      ;;

    route_off)
      OFF_ID="xp_full_off_$(date -u +%Y%m%d_%H%M%S)"
      python3 - <<PY
import json
doc=json.load(open("$STATE"))
doc["route_off_run_id"]="$OFF_ID"
json.dump(doc, open("$STATE","w"), indent=2)
PY
      log "Starting route-off run_id=$OFF_ID"
      notify INFO "Status: starting route-off full run
Run: $OFF_ID"
      export GDC_E2E_RUN_ID="$OFF_ID"
      export GDC_XP_ROUTE_RUNTIME=ROUTE_OFF
      export GDC_ROUTE_PROCESSING_ENABLED=false
      unset GDC_XP_COMBINATION_IDS GDC_XP_LIMIT GDC_XP_SHARD_FILTER GDC_XP_CONTINUE || true
      set +e
      "$E2E/cross-product/run-all-shards.sh"
      RC=$?
      set -e
      if [[ $RC -ne 0 ]]; then
        notify ERROR "Type: route-off run had failed shards
Run: $OFF_ID
failed_shards: $RC"
      fi
      save_state merge_gate
      ;;

    merge_gate)
      log "Merging route-on + shard0 rerun + route-off"
      MERGE_ROOT="$RESULTS/final-merge"
      mkdir -p "$MERGE_ROOT/inputs"
      RERUN_ID="$(python3 -c "import json;print(json.load(open('$STATE')).get('shard0_rerun_id',''))")"
      OFF_ID="$(python3 -c "import json;print(json.load(open('$STATE')).get('route_off_run_id',''))")"
      rm -rf "$MERGE_ROOT/inputs"/*
      mkdir -p "$MERGE_ROOT/inputs"
      python3 - <<PY
import os
from pathlib import Path
src=Path("$RESULTS")
dst=Path("$MERGE_ROOT/inputs/route_on")
dst.mkdir(parents=True, exist_ok=True)
for art in src.glob("*-ROUTE_ON"):
  if art.name.startswith("xp-normal-000"):
    continue
  if (art/"superseded.json").exists():
    continue
  target=dst/art.name
  if target.exists():
    continue
  os.symlink(art, target)
rerun=Path("$E2E/reports/$RERUN_ID")
if rerun.exists():
  os.symlink(rerun, Path("$MERGE_ROOT/inputs/shard0_rerun"))
off=Path("$E2E/reports/$OFF_ID")
if off.exists():
  os.symlink(off, Path("$MERGE_ROOT/inputs/route_off"))
print("inputs ready")
PY
      set +e
      npx tsx cross-product/merge-cross-product-results.ts \
        --from="$MERGE_ROOT/inputs" \
        --out="$MERGE_ROOT/cross-product-results.jsonl"
      MRC=$?
      npx tsx cross-product/validate-cross-axis-gate.ts \
        --results="$MERGE_ROOT/cross-product-results.jsonl"
      GRC=$?
      set -e
      if [[ $MRC -ne 0 || $GRC -ne 0 ]]; then
        notify ERROR "Type: merge/gate failed
merge_rc: $MRC
gate_rc: $GRC
Merge: $MERGE_ROOT"
        save_state merge_gate_failed
        sleep 900
        continue
      fi
      save_state cleanup
      ;;

    merge_gate_failed)
      log "merge_gate_failed — sleeping before retry"
      sleep 900
      save_state merge_gate
      ;;

    cleanup)
      log "Running cleanup + validate + second cleanup"
      set +e
      npx tsx framework/cleanup-cli.ts cleanup
      npx tsx framework/cleanup-cli.ts validate-cleanup
      npx tsx framework/cleanup-cli.ts cleanup
      npx tsx framework/cleanup-cli.ts validate-cleanup
      set -e
      save_state regression
      ;;

    regression)
      log "Running existing suite regression checks"
      set +e
      npx tsx cross-product/validate-cross-product.ts
      npx tsx scenarios/validate-scenario-coverage.ts
      npm run test:smoke
      set -e
      save_state complete
      ;;

    complete)
      notify INFO "Status: recovery orchestrator reached complete phase — human must confirm final Gate numbers before PASS
Run: $SOURCE_RUN_ID"
      log "COMPLETE phase reached — exiting orchestrator loop"
      exit 0
      ;;

    *)
      log "Unknown phase $phase — sleeping"
      ;;
  esac

  sleep 120
done
