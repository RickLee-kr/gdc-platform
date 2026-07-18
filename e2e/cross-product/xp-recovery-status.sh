#!/usr/bin/env bash
set -euo pipefail
RUN_ID="${1:-xp_full_on_20260717_101601}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E="$ROOT/e2e"
RESULTS="$E2E/reports/$RUN_ID"
python3 - <<PY
import json, os, time
from pathlib import Path
from collections import Counter
from datetime import datetime, timezone
base=Path("$RESULTS")
exp="009daf57881a515e73d7ef388eb1bd9bdd6e82bb2a9166fe3479b50bf5e2e307"
art=base/"xp-normal-000-ROUTE_ON"
res=art/"cross-product-results.jsonl"
if not res.exists() and (art/"original"/ "cross-product-results.jsonl").exists():
  res=art/"original"/"cross-product-results.jsonl"
rows=[]
if res.exists():
  rows=[json.loads(l) for l in res.read_text().splitlines() if l.strip()]
c=Counter(r.get("status") for r in rows)
lock=base.parent/".locks"/f"xp-full-recovery-{os.environ.get('RUN_ID','$RUN_ID')}.lock"
# fix path
lock=Path("$E2E/reports/.locks/xp-full-recovery-$RUN_ID.lock")
lock_doc=json.loads(lock.read_text()) if lock.exists() else None
state=json.loads((base/"recovery-orchestrator-state.json").read_text()) if (base/"recovery-orchestrator-state.json").exists() else {}
sup=(art/"superseded.json").exists()
s1=base/"xp-normal-001-ROUTE_ON"/"cross-product-results.jsonl"
s1_hv=None
if s1.exists():
  lines=[l for l in s1.read_text().splitlines() if l.strip()]
  if lines:
    s1_hv=json.loads(lines[0]).get("harness_version")
out={
  "captured_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "run_id": "$RUN_ID",
  "phase": state.get("phase","watch_shard0"),
  "shard0_executed": len(rows),
  "shard0_expected": 1050,
  "shard0_by_status": dict(c),
  "shard0_superseded": sup,
  "shard1_first_harness": s1_hv,
  "shard1_harness_match": (s1_hv==exp) if s1_hv else None,
  "expected_fixed_harness": exp,
  "lock": lock_doc,
  "final_verdict": "IN_PROGRESS",
}
print(json.dumps(out, indent=2))
(base/"status-snapshot.json").write_text(json.dumps(out, indent=2))
PY
