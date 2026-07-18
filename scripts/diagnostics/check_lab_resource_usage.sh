#!/usr/bin/env bash
# Read-only lab / platform resource diagnostics. NEVER deletes data.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLATFORM_COMPOSE_FILE="${PLATFORM_COMPOSE_FILE:-$ROOT/docker-compose.platform.yml}"
PG_CONTAINER="${GDC_PLATFORM_POSTGRES_CONTAINER:-gdc-platform-postgres}"
WIREMOCK_URL="${DEV_VALIDATION_WIREMOCK_BASE_URL:-http://127.0.0.1:28080}"
SCHEDULER_CONTAINER="${GDC_PLATFORM_SCHEDULER_CONTAINER:-gdc-platform-scheduler}"
API_BASE="${GDC_API_BASE_URL:-http://127.0.0.1:8000}"

echo "=== Lab resource usage (read-only) ==="
echo "host: $(hostname)  time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

echo "--- memory / swap ---"
free -h || true
echo ""

echo "--- docker stats (no-stream) ---"
if command -v docker >/dev/null 2>&1; then
  docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' 2>/dev/null || true
  echo ""
  echo "--- docker ps (names) ---"
  docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true
else
  echo "docker not available"
fi
echo ""

echo "--- postgres relation sizes (if $PG_CONTAINER is up) ---"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$PG_CONTAINER"; then
  # Estimates only — never COUNT(*) on multi-GB delivery_logs (can hang diagnostics).
  docker exec "$PG_CONTAINER" psql -U gdc -d gdc -v ON_ERROR_STOP=0 <<'SQL' || true
SELECT relname AS relation,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
       GREATEST(c.reltuples::bigint, 0) AS estimated_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND (
    relname = 'delivery_logs'
    OR relname LIKE 'delivery_logs_%'
    OR relname = 'platform_alert_history'
    OR relname = 'stream_replay_events'
  )
  AND c.relkind IN ('r', 'p')
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 40;
SQL
else
  echo "container $PG_CONTAINER not running; skip DB sizes"
fi
echo ""

echo "--- wiremock health / journal ---"
if command -v curl >/dev/null 2>&1; then
  curl -sfS --max-time 3 "${WIREMOCK_URL%/}/__admin/mappings" >/dev/null \
    && echo "OK ${WIREMOCK_URL%/}/__admin/mappings" \
    || echo "UNREACHABLE ${WIREMOCK_URL%/}/__admin/mappings"
  journal_json="$(curl -sfS --max-time 3 "${WIREMOCK_URL%/}/__admin/requests" 2>/dev/null || true)"
  if [[ -n "$journal_json" ]]; then
    JOURNAL_JSON="$journal_json" JOURNAL_LIMIT="${GDC_LAB_MAX_WIREMOCK_JOURNAL_ENTRIES:-500}" python3 - <<'PY' || true
import json, os
raw = os.environ.get("JOURNAL_JSON") or ""
limit = int(os.environ.get("JOURNAL_LIMIT") or "500")
try:
    data = json.loads(raw)
    n = len(data.get("requests") or [])
    status = "ok" if n < int(limit * 0.9) else ("warning" if n <= limit else "exceeded")
    print(f"wiremock_journal_entries current={n} limit={limit} status={status}")
except Exception as exc:
    print(f"wiremock_journal_parse_error: {exc}")
PY
  else
    echo "wiremock journal unreachable"
  fi
else
  echo "curl not available"
fi
echo ""

echo "--- scheduler container ---"
if docker ps -a --format '{{.Names}}\t{{.Status}}' 2>/dev/null | grep -F "$SCHEDULER_CONTAINER" || true; then
  :
else
  echo "scheduler container $SCHEDULER_CONTAINER not found"
fi
echo ""

echo "--- lab status API (budget / pause / auto remediation) ---"
# Prefer HTTP when GDC_API_TOKEN is set (endpoint requires ADMINISTRATOR).
# Fall back to in-container budget check so diagnostics work without a login session.
status_json=""
if command -v curl >/dev/null 2>&1; then
  curl_headers=()
  if [[ -n "${GDC_API_TOKEN:-}" ]]; then
    curl_headers=(-H "Authorization: Bearer ${GDC_API_TOKEN}")
  fi
  status_json="$(curl -sfS --max-time 90 "${curl_headers[@]}" "${API_BASE%/}/api/v1/admin/dev-validation/status" 2>/dev/null || true)"
fi
if [[ -z "$status_json" ]] && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "gdc-platform-api"; then
  echo "  note: HTTP status unavailable (auth/timeout); using api container budget check"
  status_json="$(
    docker exec gdc-platform-api python -c '
import json
from app.database import SessionLocal
from app.dev_validation_lab.lab_resource_guardrail import check_lab_resource_budget
from app.dev_validation_lab.lab_auto_remediation import auto_remediation_snapshot
db = SessionLocal()
try:
    b = check_lab_resource_budget(db, force=False, attempt_wiremock_reset=False)
finally:
    db.close()
rem = auto_remediation_snapshot()
out = dict(b)
out["resource_budget_status"] = b.get("status")
out["resource_warnings"] = b.get("warning_reasons") or []
for k, v in rem.items():
    out.setdefault(k, v)
print(json.dumps(out, default=str))
' 2>/dev/null || true
  )"
fi
if [[ -n "$status_json" ]]; then
  STATUS_JSON="$status_json" python3 - <<'PY' || true
import json, os
d = json.loads(os.environ["STATUS_JSON"])
fields = [
    "resource_guardrail_enabled",
    "resource_budget_status",
    "auto_remediation_enabled",
    "auto_cleanup_enabled",
    "auto_cleanup_last_run_at",
    "auto_cleanup_deleted_rows",
    "auto_cleanup_recovered_budget",
    "auto_cleanup_cooldown_until",
    "recoverability_status",
    "destructive_cleanup_recommended",
    "destructive_cleanup_required",
    "should_pause_lab",
    "lab_paused",
    "lab_pause_reason",
    "recent_eps",
    "delivery_logs_rows",
    "delivery_logs_rows_last_10m",
    "delivery_logs_estimated_size",
    "alert_history_rows",
    "replay_event_rows",
    "wiremock_journal_entries",
    "retention_enabled",
    "last_cleanup_at",
    "next_retry_after",
    "recommended_action",
]
for k in fields:
    print(f"  {k}={d.get(k)}")
reasons = d.get("exceeded_reasons") or []
if reasons:
    print(f"  exceeded_reasons={reasons}")
cands = d.get("partition_drop_candidates") or []
if cands:
    print(f"  partition_drop_candidates={len(cands)}")
last = d.get("auto_cleanup_last_result")
if isinstance(last, dict):
    print(f"  last_auto_cleanup_status={last.get('status')} recovered={last.get('recovered_budget')} deleted={last.get('deleted_rows')}")
warnings = d.get("resource_warnings") or d.get("warning_reasons") or []
if warnings:
    print(f"  resource_warnings={warnings[:5]}")
paused = bool(d.get("lab_paused") or d.get("should_pause_lab"))
recovered = bool(d.get("auto_cleanup_recovered_budget"))
destructive_required = bool(d.get("destructive_cleanup_required"))
print(f"  lab_paused={paused} recovered={recovered} destructive_cleanup_required={destructive_required}")
print(f"  cleanup_needed={'yes' if (paused and not recovered) or destructive_required or reasons else 'no_or_auto_handled'}")
print("")
print("--- Lab Cleanup Recoverability ---")
print(f"  recoverability_status={d.get('recoverability_status')}")
print(f"  auto_cleanup_cycles_estimated={d.get('auto_cleanup_cycles_estimated')}")
print(f"  destructive_cleanup_required={d.get('destructive_cleanup_required')}")
print(f"  destructive_cleanup_recommended={d.get('destructive_cleanup_recommended')}")
print(f"  should_pause_lab={d.get('should_pause_lab')}")
print(f"  lab_paused={d.get('lab_paused')}")
print(f"  lab_pause_reason={d.get('lab_pause_reason')}")
cands = d.get("partition_drop_candidates") or []
safe_n = sum(1 for c in cands if isinstance(c, dict) and c.get("safe_to_drop_candidate"))
print(f"  partition_drop_candidates count={len(cands)} safe_to_drop={safe_n}")
print(f"  recommended_action={d.get('recommended_action')}")
import os as _os
print(f"  GDC_LAB_AUTO_CLEANUP_MAX_ROWS_PER_RUN={_os.environ.get('GDC_LAB_AUTO_CLEANUP_MAX_ROWS_PER_RUN', '100000 (default)')}")
rs = d.get("recoverability_status")
if rs == "needs_multiple_auto_cleanup_cycles":
    print("  note: Auto cleanup can finish recovery across multiple capped cycles; lab generation is NOT paused.")
    print("  note: Current max rows per run may require many cleanup cycles for existing backlog.")
    print("  note: For lab-only recovery, consider 500000 or 1000000 if DB timeout does not occur.")
    print("  note: Environment variables are NOT changed by this script.")
elif rs == "destructive_cleanup_recommended":
    print("  note: Manual partition DROP is recommended, but lab generation is not paused.")
elif rs == "destructive_cleanup_required":
    print("  note: Automatic cleanup cannot safely recover this state. Lab generation is paused.")
elif rs == "recoverable_by_auto_cleanup":
    print("  note: Auto cleanup should recover budget; lab generation is not paused.")
elif rs == "within_budget":
    print("  note: Budget within limits or recovered via auto cleanup; lab generation is not paused.")
elif rs == "cleanup_failed" or d.get("lab_pause_reason") == "cleanup_failed":
    print("  note: Cleanup failed. Lab generation is paused until operators recover budget.")
elif d.get("lab_pause_reason") == "cleanup_insufficient":
    print("  note: Cleanup was insufficient to recover budget. Lab generation is paused.")
if cands:
    print("  partition candidates:")
    for c in cands[:20]:
        if not isinstance(c, dict):
            continue
        print(
            f"    - {c.get('partition_name')} size={c.get('estimated_size_bytes')} "
            f"rows={c.get('estimated_rows')} range={c.get('min_created_at')}..{c.get('max_created_at')} "
            f"safe={c.get('safe_to_drop_candidate')} reason={c.get('reason')}"
        )
PY
else
  echo "lab status unavailable (set GDC_API_TOKEN for HTTP, or ensure gdc-platform-api is running)"
  echo "  expected path: ${API_BASE%/}/api/v1/admin/dev-validation/status"
fi
echo ""

echo "--- lab retention / budget / auto remediation env defaults ---"
cat <<'EOF'
GDC_LAB_AUTO_REMEDIATION_ENABLED=true
GDC_LAB_AUTO_CLEANUP_ON_BUDGET_EXCEEDED=true
GDC_LAB_AUTO_WIREMOCK_RESET=true
GDC_LAB_AUTO_CLEANUP_COOLDOWN_SECONDS=300
GDC_LAB_AUTO_CLEANUP_MAX_ROWS_PER_RUN=100000
GDC_LAB_RESOURCE_GUARDRAIL_ENABLED=true
GDC_LAB_MAX_DELIVERY_LOG_ROWS=500000
GDC_LAB_PAUSE_ON_BUDGET_EXCEEDED=true
ENABLE_DEV_VALIDATION_LAB=false  # platform.yml default; lab bootstrap sets true
Auto remediation: WireMock reset + retention-aged row deletes only
Never auto: partition DROP / TRUNCATE / VACUUM FULL
Manual CLI: .venv/bin/python -m app.dev_validation_lab.lab_cleanup_cli
Manual partition SQL preview: .venv/bin/python -m app.dev_validation_lab.lab_cleanup_cli --show-partition-drop-sql
Docs: docs/operations/lab-resource-guardrails.md
EOF

echo ""
echo "Done (read-only; no deletes performed)."
