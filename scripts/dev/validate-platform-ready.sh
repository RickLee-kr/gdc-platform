#!/usr/bin/env bash
# Strong development readiness contract for the full platform stack.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.platform.yml"
COMPOSE=(docker compose -f "$COMPOSE_FILE")
ENV_FILE="$ROOT/.env"

env_or_file() {
  local key="$1" default="$2"
  if [[ -n "${!key:-}" ]]; then
    printf '%s' "${!key}"
    return 0
  fi
  python3 - "$ENV_FILE" "$key" "$default" <<'PY'
import re
import sys
from pathlib import Path

path, key, default = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    lines = Path(path).read_text(encoding="utf-8").splitlines()
except OSError:
    print(default, end="")
    raise SystemExit(0)
pat = re.compile(rf"^\s*{re.escape(key)}\s*=\s*(.*)\s*$")
for line in reversed(lines):
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    match = pat.match(line)
    if not match:
        continue
    value = match.group(1).strip().strip('"').strip("'")
    print(value or default, end="")
    break
else:
    print(default, end="")
PY
}

API_ROOT="${GDC_DEV_PLATFORM_API_ROOT:-http://127.0.0.1:${GDC_API_HOST_PORT:-8000}}"
ENTRY_HTTP_PORT="$(env_or_file GDC_HTTP_PORT 18080)"
if [[ ! "$ENTRY_HTTP_PORT" =~ ^[0-9]+$ ]] || (( ENTRY_HTTP_PORT < 1 || ENTRY_HTTP_PORT > 65535 )); then
  echo "ERROR: GDC_HTTP_PORT must be a numeric TCP port between 1 and 65535" >&2
  exit 1
fi
ENTRY_ROOT="${GDC_DEV_PLATFORM_ENTRY_ROOT:-http://127.0.0.1:${ENTRY_HTTP_PORT}}"
READY_TIMEOUT_SECONDS="${GDC_DEV_PLATFORM_READY_TIMEOUT_SECONDS:-240}"
ADMIN_USERNAME="admin"
SKIP_AUTH_CHECK=false
ADMIN_PASSWORD_CLI=""
AUTH_RUNTIME_CHECKS=true
ADMIN_LOGIN_TOKEN=""
ADMIN_LOGIN_RESULT=""
ADMIN_AUTH_STATUS=""

usage() {
  cat <<'EOF'
Usage: scripts/dev/validate-platform-ready.sh [options]

Validates the development platform stack (services, DB, Alembic, admin auth,
runtime telemetry). Reads GDC_SEED_ADMIN_PASSWORD from the environment or .env
when unset on the CLI defaults to the first-install password "admin".

Options:
  --skip-auth-check     Skip admin login and authenticated runtime API checks
                        (use when bootstrap password drift is expected)
  --admin-password PW   Use PW for login instead of bootstrap sources
  -h, --help            Show this help

Recovery when bootstrap password no longer matches the DB:
  ./scripts/admin/reset-admin-password.sh   (explicit, interactive)
  Re-run with --admin-password '<current password>'
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skip-auth-check)
        SKIP_AUTH_CHECK=true
        AUTH_RUNTIME_CHECKS=false
        shift
        ;;
      --admin-password)
        [[ $# -ge 2 && -n "${2:-}" ]] || fail "--admin-password requires a value"
        ADMIN_PASSWORD_CLI="$2"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "unknown argument: $1 (use --help)"
        ;;
    esac
  done
}

resolve_admin_password() {
  if [[ -n "$ADMIN_PASSWORD_CLI" ]]; then
    ADMIN_PASSWORD="$ADMIN_PASSWORD_CLI"
    ADMIN_PASSWORD_SOURCE="--admin-password"
    return 0
  fi
  if [[ -n "${GDC_SEED_ADMIN_PASSWORD:-}" ]]; then
    ADMIN_PASSWORD="${GDC_SEED_ADMIN_PASSWORD}"
    ADMIN_PASSWORD_SOURCE="environment:GDC_SEED_ADMIN_PASSWORD"
    return 0
  fi
  local from_env_file
  from_env_file="$(env_or_file GDC_SEED_ADMIN_PASSWORD "")"
  if [[ -n "$from_env_file" ]]; then
    ADMIN_PASSWORD="$from_env_file"
    ADMIN_PASSWORD_SOURCE=".env:GDC_SEED_ADMIN_PASSWORD"
    return 0
  fi
  ADMIN_PASSWORD="admin"
  ADMIN_PASSWORD_SOURCE="first_install_default"
}

describe_password_source() {
  case "$ADMIN_PASSWORD_SOURCE" in
    --admin-password) echo "CLI --admin-password (value not shown)" ;;
    environment:GDC_SEED_ADMIN_PASSWORD) echo "environment variable GDC_SEED_ADMIN_PASSWORD (value not shown)" ;;
    .env:GDC_SEED_ADMIN_PASSWORD) echo ".env GDC_SEED_ADMIN_PASSWORD (value not shown)" ;;
    first_install_default) echo 'first-install default password "admin"' ;;
    *) echo "$ADMIN_PASSWORD_SOURCE" ;;
  esac
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

warn() {
  echo "WARNING: $*" >&2
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

curl_json() {
  curl -fsS --max-time 8 "$1"
}

curl_json_auth() {
  local token="$1"
  local url="$2"
  curl -fsS --max-time 8 -H "Authorization: Bearer $token" "$url"
}

admin_login_attempt() {
  # Sets ADMIN_LOGIN_RESULT, ADMIN_LOGIN_TOKEN, and ADMIN_AUTH_STATUS.
  local login_body login_json login_tmp login_http_code parse_line
  ADMIN_LOGIN_RESULT=""
  ADMIN_LOGIN_TOKEN=""
  ADMIN_AUTH_STATUS=""
  login_body="$(ADMIN_USERNAME="$ADMIN_USERNAME" ADMIN_PASSWORD="$ADMIN_PASSWORD" python3 - <<'PY'
import json
import os

print(json.dumps({"username": os.environ["ADMIN_USERNAME"], "password": os.environ["ADMIN_PASSWORD"]}))
PY
)"
  login_tmp="$(mktemp)"
  login_http_code="$(
    curl -sS --max-time 8 -o "$login_tmp" -w '%{http_code}' \
      -X POST "$API_ROOT/api/v1/auth/login" \
      -H "Content-Type: application/json" \
      -d "$login_body" 2>/dev/null || echo "000"
  )"
  login_json="$(cat "$login_tmp" 2>/dev/null || true)"
  rm -f "$login_tmp"

  if [[ "$login_http_code" == "000" ]]; then
    ADMIN_LOGIN_RESULT="unreachable"
    ADMIN_AUTH_STATUS="API unreachable"
    return 1
  fi

  parse_line="$(
    LOGIN_HTTP_CODE="$login_http_code" LOGIN_JSON="$login_json" python3 <<'PY'
import json
import os

code = os.environ.get("LOGIN_HTTP_CODE", "")
raw = os.environ.get("LOGIN_JSON", "")
try:
    body = json.loads(raw) if raw.strip() else {}
except json.JSONDecodeError:
    body = {}


def detail_code(payload: dict) -> str:
    detail = payload.get("detail")
    if isinstance(detail, dict):
        return str(detail.get("error_code") or "")
    return ""


if code == "200":
    token = (body.get("access_token") or "").strip()
    user = body.get("user") if isinstance(body.get("user"), dict) else {}
    must_change = bool(user.get("must_change_password"))
    if not token:
        print("missing_access_token\t\tmissing access_token in login response")
    elif must_change:
        print(f"password_change_required\t{token}\tpassword change required")
    else:
        print(f"ok\t{token}\tvalidated")
    raise SystemExit(0)

if code == "400":
    err = detail_code(body)
    if err == "USER_AUTH_FAILED":
        print("invalid_credentials\t\tinvalid username or password")
    elif err == "PASSWORD_CHANGE_REQUIRED":
        print("password_change_required\t\tpassword change required")
    else:
        label = err or "unknown error_code"
        print(f"unexpected_http_400\t\tlogin HTTP 400 ({label})")
    raise SystemExit(0)

print(f"unexpected_http_{code}\t\tlogin HTTP {code}")
PY
  )"
  ADMIN_LOGIN_RESULT="${parse_line%%$'\t'*}"
  local rest="${parse_line#*$'\t'}"
  ADMIN_LOGIN_TOKEN="${rest%%$'\t'*}"
  ADMIN_AUTH_STATUS="${rest#*$'\t'}"
  [[ "$ADMIN_LOGIN_RESULT" == "ok" || "$ADMIN_LOGIN_RESULT" == "password_change_required" ]] && [[ -n "$ADMIN_LOGIN_TOKEN" ]]
}

print_password_change_required_next_steps() {
  echo "" >&2
  echo "Admin login: password change required (credentials accepted)." >&2
  echo "  JWT access is limited until the password is changed in the UI (must_change_password=true)." >&2
  echo "  Authenticated runtime API checks are skipped until the gate is cleared." >&2
  echo "" >&2
  echo "Next step:" >&2
  echo "  Sign in to the UI with this temporary password and change it, or use a non-temporary admin password." >&2
  echo "" >&2
}

print_bootstrap_drift_recovery() {
  local pw_source
  pw_source="$(describe_password_source)"
  echo "" >&2
  echo "Bootstrap credential drift detected:" >&2
  echo "  Platform user 'admin' exists in PostgreSQL, but login failed for password from ${pw_source}." >&2
  echo "  Persisted admin passwords are never overwritten automatically (see specs/039-default-admin-bootstrap)." >&2
  echo "" >&2
  echo "Safe recovery options:" >&2
  echo "  1. Sign in with the password you set in the UI, then re-run:" >&2
  echo "       ./scripts/dev/validate-platform-ready.sh --admin-password '<current password>'" >&2
  echo "  2. Explicit reset (interactive; sets hash to GDC_SEED_ADMIN_PASSWORD from env/.env):" >&2
  echo "       ./scripts/admin/reset-admin-password.sh" >&2
  echo "  3. Skip authenticated runtime checks when API/DB health is enough:" >&2
  echo "       ./scripts/dev/validate-platform-ready.sh --skip-auth-check" >&2
  echo "" >&2
}

validate_admin_authentication() {
  local admin_exists
  admin_exists="$(sql_scalar "SELECT count(*) FROM platform_users WHERE username = 'admin' AND role = 'ADMINISTRATOR' AND status = 'ACTIVE'")"
  [[ "$admin_exists" =~ ^[0-9]+$ ]] && (( admin_exists > 0 )) \
    || fail "admin platform user is missing (run: docker compose -f docker-compose.platform.yml exec api python -m app.db.seed --platform-admin-only)"

  echo "Checking admin login (password source: $(describe_password_source))..." >&2
  if admin_login_attempt; then
    if [[ "$ADMIN_LOGIN_RESULT" == "password_change_required" ]]; then
      AUTH_RUNTIME_CHECKS=false
      echo "[bootstrap] admin credentials accepted; password change required before full API access" >&2
      print_password_change_required_next_steps
      return 0
    fi
    echo "[bootstrap] admin auth validation passed" >&2
    return 0
  fi

  case "$ADMIN_LOGIN_RESULT" in
    unreachable)
      fail "admin login endpoint unreachable at $API_ROOT/api/v1/auth/login (API unhealthy or overloaded; not a credential issue)"
      ;;
    missing_access_token)
      fail "admin login returned HTTP 200 but access_token was missing"
      ;;
    invalid_credentials)
      if [[ "$SKIP_AUTH_CHECK" == "true" ]]; then
        warn "admin login failed (invalid credentials); continuing with --skip-auth-check"
        warn "authenticated runtime API checks (status, dashboard, logs, analytics, run-once) are skipped"
        print_bootstrap_drift_recovery
        ADMIN_LOGIN_TOKEN=""
        return 0
      fi
      if [[ "$ADMIN_PASSWORD_SOURCE" == "--admin-password" ]]; then
        fail "admin auth validation failed: invalid credentials (--admin-password rejected)"
      fi
      print_bootstrap_drift_recovery
      fail "admin auth validation failed: bootstrap password does not match persisted admin hash"
      ;;
    password_change_required)
      AUTH_RUNTIME_CHECKS=false
      echo "[bootstrap] admin credentials accepted; password change required before full API access" >&2
      print_password_change_required_next_steps
      return 0
      ;;
    *)
      fail "admin auth validation failed: ${ADMIN_AUTH_STATUS:-login returned ${ADMIN_LOGIN_RESULT}} (see API logs)"
      ;;
  esac
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

dev_validation_source_counts_check() {
  local rows missing
  rows="$("${COMPOSE[@]}" exec -T postgres psql -U gdc -d gdc -Atc "
WITH expected(label, source_type) AS (
  VALUES
    ('HTTP_API_POLLING', 'HTTP_API_POLLING'),
    ('DATABASE_QUERY', 'DATABASE_QUERY'),
    ('S3_OBJECT', 'S3_OBJECT_POLLING'),
    ('REMOTE_FILE', 'REMOTE_FILE_POLLING')
),
actual AS (
  SELECT sources.source_type, COUNT(*)::int AS count
  FROM streams
  JOIN sources ON sources.id = streams.source_id
  WHERE streams.name LIKE '[DEV VALIDATION] %'
  GROUP BY sources.source_type
)
SELECT expected.label || '=' || COALESCE(actual.count, 0)::text
FROM expected
LEFT JOIN actual ON actual.source_type = expected.source_type
ORDER BY expected.label;
" | tr '\n' ' ')"
  echo "$rows"
  missing="$(printf '%s\n' "$rows" | tr ' ' '\n' | awk -F= '$2 == "0" {print $1}' | tr '\n' ' ')"
  [[ -z "${missing// }" ]] || fail "missing dev-validation source expansion fixture streams for: $missing"
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
  curl -fsS --max-time 60 -X POST -H "Authorization: Bearer $admin_token" "$API_ROOT/api/v1/runtime/streams/$stream_id/run-once" >/dev/null

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

parse_args "$@"
resolve_admin_password

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

validate_admin_authentication
admin_token="$ADMIN_LOGIN_TOKEN"

connector_count="$(sql_scalar "SELECT count(*) FROM connectors")"
stream_count="$(sql_scalar "SELECT count(*) FROM streams")"
route_count="$(sql_scalar "SELECT count(*) FROM routes")"
destination_count="$(sql_scalar "SELECT count(*) FROM destinations")"
[[ "$connector_count" =~ ^[0-9]+$ ]] && (( connector_count > 0 )) || fail "connector count is zero"
[[ "$stream_count" =~ ^[0-9]+$ ]] && (( stream_count > 0 )) || fail "stream count is zero"
[[ "$route_count" =~ ^[0-9]+$ ]] && (( route_count > 0 )) || fail "route count is zero"
[[ "$destination_count" =~ ^[0-9]+$ ]] && (( destination_count > 0 )) || fail "destination count is zero"
dev_validation_source_counts="$(dev_validation_source_counts_check)"

dev_e2e_stream_count="$(sql_scalar "SELECT count(*) FROM streams WHERE name LIKE '[DEV E2E] %'")"
[[ "$dev_e2e_stream_count" =~ ^[0-9]+$ ]] && (( dev_e2e_stream_count >= 5 )) \
  || fail "missing UI-visible [DEV E2E] streams (run scripts/dev-validation/seed-visible-e2e-fixtures.sh or restart API with ENABLE_DEV_VALIDATION_LAB=true)"

delivery_logs_count="$(sql_scalar "SELECT count(*) FROM delivery_logs")"
analytics_summary="(skipped — auth checks disabled)"
if [[ "$ADMIN_LOGIN_RESULT" == "password_change_required" ]]; then
  admin_login_summary="password change required (credentials accepted; change password in UI for full runtime API checks)"
elif [[ -n "$admin_token" && "$AUTH_RUNTIME_CHECKS" == "true" ]]; then
  admin_login_summary="validated ($(describe_password_source))"
elif [[ "$SKIP_AUTH_CHECK" == "true" ]]; then
  admin_login_summary="skipped (--skip-auth-check)"
else
  admin_login_summary="skipped (bootstrap credential drift or auth failure)"
fi

if [[ "$AUTH_RUNTIME_CHECKS" == "true" && -n "$admin_token" ]]; then
  runtime_status="$(curl_json_auth "$admin_token" "$API_ROOT/api/v1/runtime/status")"
  printf '%s' "$runtime_status" | json_check "runtime status schema/scheduler" "body.get('schema_ready') is True and body.get('scheduler_active') is True"

  delivery_logs_count="$(wait_for_delivery_logs)"

  dashboard_json="$(curl_json_auth "$admin_token" "$API_ROOT/api/v1/runtime/dashboard/summary?window=24h&limit=100")"
  printf '%s' "$dashboard_json" | json_check "runtime dashboard non-empty" "body.get('summary', {}).get('recent_logs', 0) > 0 and body.get('summary', {}).get('delivery_outcome_events', 0) > 0"

  logs_json="$(curl_json_auth "$admin_token" "$API_ROOT/api/v1/runtime/logs/search?limit=20")"
  printf '%s' "$logs_json" | json_check "logs explorer non-empty" "body.get('total_returned', 0) > 0 and len(body.get('logs') or []) > 0"

  analytics_json="$(curl_json_auth "$admin_token" "$API_ROOT/api/v1/runtime/analytics/delivery-outcomes/destinations?window=24h")"
  printf '%s' "$analytics_json" | json_check "runtime analytics non-empty" "sum((row.get('success_events', 0) + row.get('failure_events', 0)) for row in (body.get('rows') or [])) > 0"
  analytics_summary="$(printf '%s' "$analytics_json" | json_value "[(row.get('destination_id'), row.get('success_events', 0), row.get('failure_events', 0)) for row in body.get('rows', [])]")"
else
  if [[ "$ADMIN_LOGIN_RESULT" != "password_change_required" ]]; then
    if [[ "$delivery_logs_count" =~ ^[0-9]+$ ]] && (( delivery_logs_count == 0 )); then
      warn "delivery_logs count is 0; authenticated run-once fallback was not executed"
    fi
  fi
fi

echo ""
echo "Development platform ready."
echo "  API: healthy ($API_ROOT/health)"
echo "  Frontend: healthy (service healthcheck)"
echo "  Reverse proxy: healthy ($ENTRY_ROOT/health)"
echo "  PostgreSQL: healthy ($db_identity)"
echo "  Alembic: head"
echo "  Admin login: $admin_login_summary"
echo "  Dev inventory: connectors=$connector_count streams=$stream_count routes=$route_count destinations=$destination_count"
echo "  Dev validation source types: $dev_validation_source_counts"
echo "  Visible [DEV E2E] streams: $dev_e2e_stream_count"
if [[ "$AUTH_RUNTIME_CHECKS" == "true" && -n "$admin_token" ]]; then
  echo "  Scheduler/runtime: active"
  echo "  delivery_logs count: $delivery_logs_count"
  echo "  Runtime API sample: delivery outcomes by destination $analytics_summary"
elif [[ "$ADMIN_LOGIN_RESULT" == "password_change_required" ]]; then
  echo "  Scheduler/runtime: blocked (password change required)"
  echo "  delivery_logs count: $delivery_logs_count (DB only)"
else
  echo "  Scheduler/runtime: not validated (auth checks skipped)"
  echo "  delivery_logs count: $delivery_logs_count (DB only)"
fi
