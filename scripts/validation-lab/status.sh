#!/usr/bin/env bash
# Dev Validation Lab — simplified status command.
#
# Shows everything an operator needs to triage the lab in one place:
#   - Docker test stack (containers / ports)
#   - Backend reachable (GET /health, GET /docs)
#   - Frontend reachable (GET http://127.0.0.1:5173)
#   - [DEV VALIDATION] connector count (live API)
#   - dev_lab validation definition count (live API)
#   - Latest validation failures and open alerts (GET /validation/failures/summary)
#   - Recent dev_validation_lab log lines
#
# This wraps scripts/dev-validation/status-dev-validation-lab.sh and appends a
# focused "validation failures" section. Read-only: it never mutates DB or files.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNDERLYING="$ROOT/scripts/dev-validation/status-dev-validation-lab.sh"
API_ROOT="${DEV_VALIDATION_API_ROOT:-http://127.0.0.1:8000}"
API_PREFIX="${DEV_VALIDATION_API_PREFIX:-/api/v1}"

if [[ ! -x "$UNDERLYING" ]]; then
  echo "ERROR: cannot execute $UNDERLYING" >&2
  exit 1
fi

"$UNDERLYING" "$@"

echo ""
echo "=== Latest validation failures (GET ${API_PREFIX}/validation/failures/summary) ==="
SUMMARY_BODY="$(curl -fsS --max-time 4 "$API_ROOT${API_PREFIX}/validation/failures/summary?limit=10" 2>/dev/null || true)"
if [[ -z "$SUMMARY_BODY" ]]; then
  echo "  (API not reachable or endpoint failed; backend may be down)"
else
  GDC_FAILURES_BODY="$SUMMARY_BODY" python3 <<'PY' 2>/dev/null || echo "  (failed to parse failures summary)"
import json
import os

raw = os.environ.get("GDC_FAILURES_BODY", "")
try:
    data = json.loads(raw)
except Exception as exc:
    print(f"  (parse error: {exc})")
    raise SystemExit(0)

failing = data.get("failing_validations_count", 0)
degraded = data.get("degraded_validations_count", 0)
crit = data.get("open_alerts_critical", 0)
warn = data.get("open_alerts_warning", 0)
auth = data.get("open_auth_failure_alerts", 0)
deliv = data.get("open_delivery_failure_alerts", 0)
drift = data.get("open_checkpoint_drift_alerts", 0)

print(f"  failing validations:       {failing}")
print(f"  degraded validations:      {degraded}")
print(f"  open alerts (critical):    {crit}")
print(f"  open alerts (warning):     {warn}")
print(f"  delivery failure alerts:   {deliv}")
print(f"  auth failure alerts:       {auth}")
print(f"  checkpoint drift alerts:   {drift}")

alerts = data.get("latest_open_alerts") or []
if not alerts:
    print("  latest_open_alerts: (none)")
else:
    print("  latest_open_alerts:")
    for a in alerts[:10]:
        sev = a.get("severity", "?")
        vid = a.get("validation_id", "?")
        atype = a.get("alert_type", "?")
        ts = a.get("triggered_at", "?")
        title = (a.get("title") or "").strip()
        msg = (a.get("message") or "").strip()
        if len(msg) > 160:
            msg = msg[:157] + "..."
        print(f"   - [{sev:>8}] val#{vid} {atype} @ {ts}")
        print(f"       {title}")
        if msg and msg != title:
            print(f"       {msg}")
PY
fi

echo ""
echo "=== Commands ==="
THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "  start:    $THIS_DIR/start.sh"
echo "  stop:     $THIS_DIR/stop.sh --with-docker"
echo "  reset DB: $THIS_DIR/reset-db.sh   (destructive; gdc_test only)"
