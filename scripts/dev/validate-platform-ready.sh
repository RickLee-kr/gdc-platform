#!/usr/bin/env bash
# Strong development readiness contract for the full platform stack.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.platform.yml"
COMPOSE=(docker compose -f "$COMPOSE_FILE")

API_ROOT="${GDC_DEV_PLATFORM_API_ROOT:-http://127.0.0.1:${GDC_API_HOST_PORT:-8000}}"
ENTRY_ROOT="${GDC_DEV_PLATFORM_ENTRY_ROOT:-http://127.0.0.1:${GDC_ENTRY_HTTP_PORT:-18080}}"
READY_TIMEOUT_SECONDS="${GDC_DEV_PLATFORM_READY_TIMEOUT_SECONDS:-240}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

curl_json() {
  curl -fsS --max-time 8 "$1"
}

json_check() {
  local description="$1"
  local expression="$2"
  python3 -c 'import json, sys
description = sys.argv[1]
expression = sys.argv[2]
body = json.load(sys.stdin)
safe_globals = {"__builtins__": {}, "len": len, "sum": sum}
if not eval(expression, safe_globals, {"body": body}):
    raise SystemExit(f"check failed: {description}")' "$description" "$expression"
}

json_value() {
  local expression="$1"
  python3 -c 'import json, sys
body = json.load(sys.stdin)
safe_globals = {"__builtins__": {}, "len": len, "sum": sum}
value = eval(sys.argv[1], safe_globals, {"body": body})
print(value)' "$expression"
}

service_ok() {
  local service="$1"
  local require_healthy="$2"
  local cid state health
  cid="$("${COMPOSE[@]}" ps -q "$service" 2>/dev/null || true)"
  [[ -n "$cid" ]] || return 1
  state="$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || true)"
  [[ "$state" == "running" ]] || return 1
  if [[ "$require_healthy" == "true" ]]; then
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || true)"
    [[ "$health" == "healthy" ]] || return 1
  fi
}

wait_for_services() {
  local deadline
  deadline=$((SECONDS + READY_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    if service_ok postgres true \
      && service_ok api true \
      && service_ok frontend true \
      && service_ok reverse-proxy true \
      && service_ok gdc-wiremock-test false \
      && service_ok gdc-webhook-receiver-test false \
      && service_ok gdc-syslog-test false; then
      return 0
    fi
    sleep 3
  done
  "${COMPOSE[@]}" ps >&2 || true
  fail "platform services did not become running/healthy within ${READY_TIMEOUT_SECONDS}s"
}

sql_scalar() {
  local query="$1"
  "${COMPOSE[@]}" exec -T postgres psql -U gdc -d gdc -Atc "$query" | tr -d '[:space:]'
}

alembic_head_check() {
  "${COMPOSE[@]}" exec -T api python - <<'PY'
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text

from app.config import settings

cfg = Config("alembic.ini")
cfg.set_main_option("script_location", "alembic")
heads = tuple(ScriptDirectory.from_config(cfg).get_heads())
engine = create_engine(settings.DATABASE_URL)
with engine.connect() as conn:
    row = conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).first()
current = str(row[0]) if row else None
if len(heads) != 1 or current != heads[0]:
    raise SystemExit(f"alembic not at head: current={current!r} heads={heads!r}")
print(f"{current} == {heads[0]}")
PY
}

select_dev_validation_stream_id() {
  sql_scalar "SELECT id FROM streams WHERE enabled IS TRUE AND name LIKE '[DEV VALIDATION] %' ORDER BY id ASC LIMIT 1"
}

wait_for_delivery_logs() {
  local count stream_id
  local deadline=$((SECONDS + READY_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    count="$(sql_scalar "SELECT count(*) FROM delivery_logs")"
    if [[ "$count" =~ ^[0-9]+$ ]] && (( count > 0 )); then
      echo "$count"
      return 0
    fi
    sleep 3
  done

  stream_id="$(select_dev_validation_stream_id)"
  [[ "$stream_id" =~ ^[0-9]+$ ]] || fail "delivery_logs are empty and no enabled [DEV VALIDATION] stream is available"
  echo "delivery_logs are empty after wait; triggering real StreamRunner path for stream_id=$stream_id" >&2
  curl -fsS --max-time 60 -X POST "$API_ROOT/api/v1/runtime/streams/$stream_id/run-once" >/dev/null

  for _ in $(seq 1 20); do
    count="$(sql_scalar "SELECT count(*) FROM delivery_logs")"
    if [[ "$count" =~ ^[0-9]+$ ]] && (( count > 0 )); then
      echo "$count"
      return 0
    fi
    sleep 2
  done
  fail "real runtime run completed but delivery_logs are still empty"
}

require_cmd docker
require_cmd curl
require_cmd python3

echo "Compose status:"
"${COMPOSE[@]}" ps

wait_for_services

health_json="$(curl_json "$API_ROOT/health")"
printf '%s' "$health_json" | json_check "/health delivery log indexes" "body.get('delivery_logs_indexes', {}).get('ok') is True"

curl -fsS --max-time 8 "$ENTRY_ROOT/health" >/dev/null || fail "reverse proxy health endpoint failed"

db_identity="$(sql_scalar "SELECT current_user || ':' || current_database()")"
[[ "$db_identity" == "gdc:gdc" ]] || fail "DB identity mismatch: expected gdc:gdc, got ${db_identity:-<empty>}"

echo "Checking Alembic head..."
alembic_head_check >/dev/null

admin_count="$(sql_scalar "SELECT count(*) FROM platform_users WHERE username = 'admin' AND role = 'ADMINISTRATOR' AND status = 'ACTIVE'")"
[[ "$admin_count" =~ ^[0-9]+$ ]] && (( admin_count > 0 )) || fail "admin platform user is missing"

connector_count="$(sql_scalar "SELECT count(*) FROM connectors")"
stream_count="$(sql_scalar "SELECT count(*) FROM streams")"
route_count="$(sql_scalar "SELECT count(*) FROM routes")"
destination_count="$(sql_scalar "SELECT count(*) FROM destinations")"
[[ "$connector_count" =~ ^[0-9]+$ ]] && (( connector_count > 0 )) || fail "connector count is zero"
[[ "$stream_count" =~ ^[0-9]+$ ]] && (( stream_count > 0 )) || fail "stream count is zero"
[[ "$route_count" =~ ^[0-9]+$ ]] && (( route_count > 0 )) || fail "route count is zero"
[[ "$destination_count" =~ ^[0-9]+$ ]] && (( destination_count > 0 )) || fail "destination count is zero"

runtime_status="$(curl_json "$API_ROOT/api/v1/runtime/status")"
printf '%s' "$runtime_status" | json_check "runtime status schema/scheduler" "body.get('schema_ready') is True and body.get('scheduler_active') is True"

delivery_logs_count="$(wait_for_delivery_logs)"

dashboard_json="$(curl_json "$API_ROOT/api/v1/runtime/dashboard/summary?window=24h&limit=100")"
printf '%s' "$dashboard_json" | json_check "runtime dashboard non-empty" "body.get('summary', {}).get('recent_logs', 0) > 0 and body.get('summary', {}).get('delivery_outcome_events', 0) > 0"

logs_json="$(curl_json "$API_ROOT/api/v1/runtime/logs/search?limit=20")"
printf '%s' "$logs_json" | json_check "logs explorer non-empty" "body.get('total_returned', 0) > 0 and len(body.get('logs') or []) > 0"

analytics_json="$(curl_json "$API_ROOT/api/v1/runtime/analytics/delivery-outcomes/destinations?window=24h")"
printf '%s' "$analytics_json" | json_check "runtime analytics non-empty" "sum((row.get('success_events', 0) + row.get('failure_events', 0)) for row in (body.get('rows') or [])) > 0"
analytics_summary="$(printf '%s' "$analytics_json" | json_value "[(row.get('destination_id'), row.get('success_events', 0), row.get('failure_events', 0)) for row in body.get('rows', [])]")"

echo ""
echo "Development platform ready."
echo "  API: healthy ($API_ROOT/health)"
echo "  Frontend: healthy (service healthcheck)"
echo "  Reverse proxy: healthy ($ENTRY_ROOT/health)"
echo "  PostgreSQL: healthy ($db_identity)"
echo "  Alembic: head"
echo "  Admin user: available"
echo "  Dev inventory: connectors=$connector_count streams=$stream_count routes=$route_count destinations=$destination_count"
echo "  Scheduler/runtime: active"
echo "  delivery_logs count: $delivery_logs_count"
echo "  Runtime API sample: delivery outcomes by destination $analytics_summary"
