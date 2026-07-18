#!/usr/bin/env bash
# Observe-only watcher for legacy shard-0 → SUPERSEDED → shard-1 harness → canary.
# Never kills playwright / run-all-shards. Exits after canary verdict is recorded.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E="$ROOT/e2e"
RUN_ID="${1:-xp_full_on_20260717_101601}"
RESULTS="$E2E/reports/$RUN_ID"
OUT="$RESULTS/transition-watch.json"
LOG="$RESULTS/transition-watch.log"
EXPECTED_HV="009daf57881a515e73d7ef388eb1bd9bdd6e82bb2a9166fe3479b50bf5e2e307"
ORCH_PID_FILE="$E2E/reports/.pids/xp_full_on.pid"
RECOVERY_PID_FILE="$E2E/reports/.pids/xp_recovery.pid"

mkdir -p "$RESULTS"
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG"; }
notify() { /usr/local/bin/notify.sh "$1" "Project: gdc-platform

$*" || true; }

LAST_PHASE=""
LAST_ROWS=0
LAST_FAIL=0
NOTIFIED_COMPLETE=0
NOTIFIED_SUPERSEDED=0
NOTIFIED_HARNESS=0
NOTIFIED_CANARY=0

while true; do
  STATUS_JSON="$(bash "$E2E/cross-product/xp-recovery-status.sh" 2>/dev/null || echo '{}')"
  python3 - <<PY
import json, os, time, subprocess
from pathlib import Path
from collections import Counter
from datetime import datetime, timezone

run_id = "$RUN_ID"
base = Path("$RESULTS")
exp = "$EXPECTED_HV"
art0 = base / "xp-normal-000-ROUTE_ON"
art1 = base / "xp-normal-001-ROUTE_ON"
out_path = Path("$OUT")

def alive(pid):
    if not pid: return False
    try:
        os.kill(int(pid), 0)
        return True
    except Exception:
        return False

def read_pid(path):
    p = Path(path)
    if not p.exists(): return None
    return p.read_text().strip().splitlines()[0]

orch_pid = read_pid("$ORCH_PID_FILE")
rec_pid = read_pid("$RECOVERY_PID_FILE")
# discover playwright for this run
pw_alive = False
try:
    r = subprocess.check_output(["pgrep", "-af", "playwright test"], text=True)
    pw_alive = "cross-product" in r or "playwright" in r
except Exception:
    pw_alive = False

res = art0 / "cross-product-results.jsonl"
if not res.exists() and (art0 / "original" / "cross-product-results.jsonl").exists():
    res = art0 / "original" / "cross-product-results.jsonl"
rows = []
if res.exists():
    rows = [json.loads(l) for l in res.read_text().splitlines() if l.strip()]
c = Counter(r.get("status") for r in rows)
fails = [r for r in rows if r.get("status") == "FAIL"]
tax = Counter()
for r in fails:
    d = r.get("detail") or ""
    if "WEBHOOK_AUTH" in d: tax["webhook_bearer_401"] += 1
    elif "STREAM_SOURCE_FETCH" in d: tax["stream_source_fetch_502"] += 1
    else: tax["other"] += 1

man = {}
for cand in [art0 / "shard-manifest.json", art0 / "original" / "shard-manifest.json"]:
    if cand.exists():
        man = json.loads(cand.read_text())
        break

sup = None
if (art0 / "superseded.json").exists():
    sup = json.loads((art0 / "superseded.json").read_text())

incomplete = None
if (art0 / "incomplete.json").exists():
    incomplete = json.loads((art0 / "incomplete.json").read_text())

state = {}
if (base / "recovery-orchestrator-state.json").exists():
    state = json.loads((base / "recovery-orchestrator-state.json").read_text())

# completion checks
ended = man.get("ended_at") is not None or man.get("exit_code") is not None
expected = int(man.get("expected_combinations") or 1050)
executed = len(rows)
unique = len({r.get("combination_id") for r in rows if r.get("combination_id")})
stable = False
if res.exists():
    stable = (time.time() - res.stat().st_mtime) >= 90
evidence_dirs = list(art0.glob("cross_product__xp_*"))
if not evidence_dirs and (art0 / "original").exists():
    evidence_dirs = list((art0 / "original").glob("cross_product__xp_*"))
cleanup_ok_rows = sum(1 for r in rows if "cleanup_ok" in r)
abnormal = (art0 / "abnormal-exit.json").exists() or (art0 / "shard-preflight-fail.json").exists()
# playwright for shard-0 specifically: if superseded/original moved, shard0 pw gone
shard0_pw_gone = (not pw_alive) or (art1.exists()) or bool(sup)

completion = {
    "playwright_or_moved_on": bool(shard0_pw_gone or ended),
    "expected_1050": expected == 1050,
    "executed_1050": executed >= 1050,
    "unique_1050": unique >= 1050,
    "shard_summary": bool(man.get("ended_at") is not None or man.get("exit_code") is not None or sup),
    "evidence_flush": len(evidence_dirs) >= max(0, executed - 5) if executed else False,
    "cleanup_recorded": cleanup_ok_rows >= max(1, int(executed * 0.9)) if executed else False,
    "no_abnormal_marker": not abnormal,
    "results_stable": stable or bool(sup),
}
completion["complete"] = all(completion.values()) if executed else False
if incomplete:
    completion["incomplete_marker"] = incomplete

# shard-1 harness
s1_hv = None
s1_rows = 0
s1_meta = {}
s1_res = art1 / "cross-product-results.jsonl"
if s1_res.exists():
    s1_lines = [l for l in s1_res.read_text().splitlines() if l.strip()]
    s1_rows = len(s1_lines)
    if s1_lines:
        first = json.loads(s1_lines[0])
        s1_hv = first.get("harness_version")
        s1_meta = {
            "harness_version": s1_hv,
            "manifest_hash": first.get("manifest_hash"),
            "applicability_rules_hash": first.get("applicability_rules_hash"),
            "combination_id": first.get("combination_id"),
            "status": first.get("status"),
        }

canary = None
if (art1 / "live-canary.json").exists():
    canary = json.loads((art1 / "live-canary.json").read_text())

# env guard from live run-all-shards if present
env_guard = {"GDC_XP_COMBINATION_IDS": "unknown", "GDC_XP_LIMIT": "unknown"}
if orch_pid and alive(orch_pid):
    try:
        env = Path(f"/proc/{orch_pid}/environ").read_bytes().split(b"\0")
        d = {}
        for e in env:
            if b"=" in e:
                k, v = e.split(b"=", 1)
                d[k.decode()] = v.decode()
        env_guard = {
            "GDC_XP_COMBINATION_IDS": d.get("GDC_XP_COMBINATION_IDS", "(unset)"),
            "GDC_XP_LIMIT": d.get("GDC_XP_LIMIT", "(unset)"),
            "GDC_XP_SHARD": d.get("GDC_XP_SHARD"),
            "GDC_E2E_RUN_ID": d.get("GDC_E2E_RUN_ID"),
        }
    except Exception as e:
        env_guard["error"] = str(e)

doc = {
    "captured_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "run_id": run_id,
    "phase": state.get("phase", "watch_shard0"),
    "pids": {
        "run_all_shards": orch_pid,
        "run_all_shards_alive": alive(orch_pid),
        "recovery": rec_pid,
        "recovery_alive": alive(rec_pid),
        "playwright_seen": pw_alive,
    },
    "shard0": {
        "executed": executed,
        "expected": expected,
        "unique": unique,
        "by_status": dict(c),
        "fail_taxonomy": dict(tax),
        "results_path": str(res) if res.exists() else None,
        "results_mtime": datetime.fromtimestamp(res.stat().st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if res.exists() else None,
        "superseded": bool(sup),
        "completion": completion,
    },
    "superseded": sup,
    "shard1": {
        "started": art1.exists(),
        "rows": s1_rows,
        "first_row": s1_meta,
        "harness_match": (s1_hv == exp) if s1_hv else None,
        "expected_harness": exp,
    },
    "env_guard": env_guard,
    "live_canary": canary,
    "verdict": "IN_PROGRESS",
}

if completion.get("complete") and not sup:
    doc["verdict"] = "SHARD0_COMPLETE_AWAITING_SUPERSEDE"
elif sup and s1_hv is None:
    doc["verdict"] = "SUPERSEDED_AWAITING_SHARD1"
elif s1_hv and s1_hv != exp:
    doc["verdict"] = "SHARD1_HARNESS_MISMATCH"
elif s1_hv == exp and (not canary or not canary.get("canary_pass")):
    doc["verdict"] = "SHARD1_HARNESS_OK_AWAITING_CANARY"
elif canary and canary.get("canary_pass") and canary.get("trusted_final"):
    doc["verdict"] = "TRANSITION_VERIFIED_CANARY_PASS"
elif canary and canary.get("canary_pass") is False:
    doc["verdict"] = "CANARY_FAILED"

out_path.write_text(json.dumps(doc, indent=2))
print(json.dumps({
    "verdict": doc["verdict"],
    "phase": doc["phase"],
    "executed": executed,
    "fail": c.get("FAIL", 0),
    "superseded": bool(sup),
    "s1_hv": s1_hv,
    "canary": (canary or {}).get("canary_pass"),
    "complete": completion.get("complete"),
}, indent=2))

# markers for shell
Path("$RESULTS/.tw_executed").write_text(str(executed))
Path("$RESULTS/.tw_fail").write_text(str(c.get("FAIL", 0)))
Path("$RESULTS/.tw_verdict").write_text(doc["verdict"])
Path("$RESULTS/.tw_phase").write_text(doc["phase"])
Path("$RESULTS/.tw_s1hv").write_text(s1_hv or "")
Path("$RESULTS/.tw_complete").write_text("1" if completion.get("complete") else "0")
Path("$RESULTS/.tw_superseded").write_text("1" if sup else "0")
PY

  VERDICT="$(cat "$RESULTS/.tw_verdict" 2>/dev/null || echo IN_PROGRESS)"
  PHASE="$(cat "$RESULTS/.tw_phase" 2>/dev/null || echo watch_shard0)"
  ROWS="$(cat "$RESULTS/.tw_executed" 2>/dev/null || echo 0)"
  FAILN="$(cat "$RESULTS/.tw_fail" 2>/dev/null || echo 0)"
  S1HV="$(cat "$RESULTS/.tw_s1hv" 2>/dev/null || true)"
  COMPLETE="$(cat "$RESULTS/.tw_complete" 2>/dev/null || echo 0)"
  SUPERSEDED="$(cat "$RESULTS/.tw_superseded" 2>/dev/null || echo 0)"

  if [[ "$ROWS" != "$LAST_ROWS" || "$FAILN" != "$LAST_FAIL" || "$PHASE" != "$LAST_PHASE" ]]; then
    log "progress rows=$ROWS fail=$FAILN phase=$PHASE verdict=$VERDICT s1hv=${S1HV:0:16}"
    LAST_ROWS="$ROWS"
    LAST_FAIL="$FAILN"
    LAST_PHASE="$PHASE"
  fi

  if [[ "$COMPLETE" == "1" && "$NOTIFIED_COMPLETE" == "0" ]]; then
    notify INFO "Status: shard-0 completion criteria met
Run: $RUN_ID
Executed: $ROWS / 1050
Fail: $FAILN
Next: SUPERSEDED"
    NOTIFIED_COMPLETE=1
  fi

  if [[ "$SUPERSEDED" == "1" && "$NOTIFIED_SUPERSEDED" == "0" ]]; then
    notify INFO "Status: shard-0 SUPERSEDED verified
Run: $RUN_ID
Path: $RESULTS/xp-normal-000-ROUTE_ON/superseded.json
Next: shard-1 harness check"
    NOTIFIED_SUPERSEDED=1
  fi

  if [[ -n "$S1HV" && "$NOTIFIED_HARNESS" == "0" ]]; then
    if [[ "$S1HV" == "$EXPECTED_HV" ]]; then
      notify INFO "Status: shard-1 harness MATCH
Hash: ${S1HV:0:16}...
Run: $RUN_ID
Next: Live Canary"
    else
      notify ERROR "Type: shard-1 harness MISMATCH
Got: ${S1HV:0:16}...
Expected: ${EXPECTED_HV:0:16}...
Run: $RUN_ID"
    fi
    NOTIFIED_HARNESS=1
  fi

  if [[ "$VERDICT" == "TRANSITION_VERIFIED_CANARY_PASS" && "$NOTIFIED_CANARY" == "0" ]]; then
    notify INFO "Status: Transition verified — Canary PASS
Run: $RUN_ID
Phase: $PHASE
Verdict: route-on remainder may proceed under fixed harness"
    NOTIFIED_CANARY=1
    log "DONE transition verified"
    exit 0
  fi

  if [[ "$VERDICT" == "CANARY_FAILED" || "$VERDICT" == "SHARD1_HARNESS_MISMATCH" ]]; then
    if [[ "$NOTIFIED_CANARY" == "0" ]]; then
      notify ERROR "Type: transition verification failed
Verdict: $VERDICT
Run: $RUN_ID
Phase: $PHASE"
      NOTIFIED_CANARY=1
    fi
    # keep watching for resume/fix; do not exit
  fi

  sleep 60
done
