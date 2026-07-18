#!/usr/bin/env bash
# Strong development readiness contract for the full platform stack.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.platform.yml"
PLATFORM_OVERLAY="$ROOT/docker-compose.platform.dev-validation.yml"
COMPOSE=(docker compose -f "$COMPOSE_FILE" -f "$PLATFORM_OVERLAY")
TEST_COMPOSE_FILE="$ROOT/docker-compose.test.yml"
DEV_VALIDATION_NET="${GDC_DEV_VALIDATION_DOCKER_NETWORK:-gdc-dev-validation}"
ENV_FILE="$ROOT/.env"

HARD_FAIL=0
WARN_COUNT=0
SECTION=""

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
PLATFORM_PG_PORT="$(env_or_file GDC_PLATFORM_POSTGRES_HOST_PORT 55432)"
ONTOLOGY_TEST_URL="${ONTOLOGY_TEST_DATABASE_URL:-postgresql://gdc_ontology:gdc_ontology_pw@127.0.0.1:55440/gdc_ontology_test}"
SMOKE_TEST_URL="${TEST_DATABASE_URL:-postgresql://gdc:gdc@127.0.0.1:55441/gdc_pytest}"

ADMIN_USERNAME="admin"
SKIP_AUTH_CHECK=false
ADMIN_PASSWORD_CLI=""
AUTH_RUNTIME_CHECKS=true
ADMIN_LOGIN_TOKEN=""
ADMIN_LOGIN_RESULT=""
ADMIN_AUTH_STATUS=""
ADMIN_PASSWORD=""
ADMIN_PASSWORD_SOURCE=""
CREDENTIAL_DRIFT=false

usage() {
  cat <<'EOF'
Usage: scripts/dev/validate-platform-ready.sh [options]

Validates the development platform stack in named sections (compose, DB, Alembic,
API health, admin auth, dev fixtures, pytest DBs). Reads passwords from (first match):
  --admin-password, GDC_VALIDATE_ADMIN_PASSWORD, GDC_SEED_ADMIN_PASSWORD, .env, or "admin".

Options:
  --skip-auth-check     Skip admin login and authenticated runtime API checks
  --admin-password PW   Use PW for login instead of bootstrap sources
  -h, --help            Show this help

Recovery when bootstrap password no longer matches the DB:
  ./scripts/admin/reset-admin-password.sh --username admin --password '<new>'
  Re-run with GDC_VALIDATE_ADMIN_PASSWORD=... or --admin-password '<current password>'
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
        [[ $# -ge 2 && -n "${2:-}" ]] || section_fail "--admin-password requires a value"
        ADMIN_PASSWORD_CLI="$2"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        section_fail "unknown argument: $1 (use --help)"
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
  if [[ -n "${GDC_VALIDATE_ADMIN_PASSWORD:-}" ]]; then
    ADMIN_PASSWORD="${GDC_VALIDATE_ADMIN_PASSWORD}"
    ADMIN_PASSWORD_SOURCE="environment:GDC_VALIDATE_ADMIN_PASSWORD"
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
    environment:GDC_VALIDATE_ADMIN_PASSWORD) echo "GDC_VALIDATE_ADMIN_PASSWORD (value not shown)" ;;
    environment:GDC_SEED_ADMIN_PASSWORD) echo "environment variable GDC_SEED_ADMIN_PASSWORD (value not shown)" ;;
    .env:GDC_SEED_ADMIN_PASSWORD) echo ".env GDC_SEED_ADMIN_PASSWORD (value not shown)" ;;
    first_install_default) echo 'first-install default password "admin"' ;;
    *) echo "$ADMIN_PASSWORD_SOURCE" ;;
  esac
}

section_begin() {
  SECTION="$1"
  echo ""
  echo "=== $SECTION ==="
}

section_ok() {
  echo "  OK: $*"
}

section_fail() {
  echo "  FAIL: $*" >&2
  HARD_FAIL=1
}

section_warn() {
  echo "  WARNING: $*" >&2
  WARN_COUNT=$((WARN_COUNT + 1))
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || section_fail "required command not found: $1"
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
  section_warn "admin login accepted; password change required before full JWT runtime API checks"
  echo "  Next: sign in to the UI and change the password, or use a non-temporary admin password." >&2
}

print_bootstrap_drift_recovery() {
  local pw_source
  pw_source="$(describe_password_source)"
  section_warn "credential drift: platform user 'admin' exists but login failed for password from ${pw_source}"
  echo "  Persisted admin passwords are never overwritten automatically." >&2
  echo "  Recovery:" >&2
  echo "    GDC_VALIDATE_ADMIN_PASSWORD='<current>' ./scripts/dev/validate-platform-ready.sh" >&2
  echo "    ./scripts/dev/validate-platform-ready.sh --admin-password '<current password>'" >&2
  echo "    ./scripts/admin/reset-admin-password.sh --username admin --password '<new>'" >&2
}

validate_admin_authentication() {
  local admin_exists
  admin_exists="$(sql_scalar "SELECT count(*) FROM platform_users WHERE username = 'admin' AND role = 'ADMINISTRATOR' AND status = 'ACTIVE'")"
  if [[ ! "$admin_exists" =~ ^[0-9]+$ ]] || (( admin_exists == 0 )); then
    section_fail "admin platform user is missing (run bootstrap or: docker compose exec api python -m app.db.seed --platform-admin-only)"
    return 1
  fi
  section_ok "platform user 'admin' exists"

  echo "  Checking admin login (password source: $(describe_password_source))..." >&2
  if admin_login_attempt; then
    if [[ "$ADMIN_LOGIN_RESULT" == "password_change_required" ]]; then
      AUTH_RUNTIME_CHECKS=false
      print_password_change_required_next_steps
      return 0
    fi
    section_ok "admin auth validated"
    return 0
  fi

  case "$ADMIN_LOGIN_RESULT" in
    unreachable)
      section_fail "admin login endpoint unreachable at $API_ROOT/api/v1/auth/login"
      return 1
      ;;
    missing_access_token)
      section_fail "admin login returned HTTP 200 but access_token was missing"
      return 1
      ;;
    invalid_credentials)
      CREDENTIAL_DRIFT=true
      AUTH_RUNTIME_CHECKS=false
      ADMIN_LOGIN_TOKEN=""
      if [[ "$SKIP_AUTH_CHECK" == "true" ]]; then
        section_warn "admin login failed (invalid credentials); continuing with --skip-auth-check"
      else
        print_bootstrap_drift_recovery
      fi
      return 0
      ;;
    password_change_required)
      AUTH_RUNTIME_CHECKS=false
      print_password_change_required_next_steps
      return 0
      ;;
    *)
      if [[ "$ADMIN_PASSWORD_SOURCE" == "--admin-password" || "$ADMIN_PASSWORD_SOURCE" == "environment:GDC_VALIDATE_ADMIN_PASSWORD" ]]; then
        section_fail "admin auth failed: ${ADMIN_AUTH_STATUS:-${ADMIN_LOGIN_RESULT}}"
      else
        CREDENTIAL_DRIFT=true
        AUTH_RUNTIME_CHECKS=false
        print_bootstrap_drift_recovery
      fi
      return 0
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

container_healthy() {
  local name="$1"
  local health
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$name" 2>/dev/null || echo missing)"
  [[ "$health" == "healthy" ]]
}

check_compose_status() {
  section_begin "Compose status"
  "${COMPOSE[@]}" ps
  local svc
  for svc in postgres api frontend reverse-proxy scheduler; do
    if service_ok "$svc" true; then
      section_ok "$svc running/healthy"
    else
      section_fail "$svc not running/healthy"
    fi
  done
  for svc in gdc-wiremock-test gdc-webhook-receiver-test gdc-syslog-test; do
    if service_ok "$svc" false; then
      section_ok "$svc running"
    else
      section_warn "$svc not running (embedded platform fixtures)"
    fi
  done
}

wait_for_core_services() {
  local deadline=$((SECONDS + READY_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    if service_ok postgres true && service_ok api true \
      && service_ok frontend true && service_ok reverse-proxy true \
      && service_ok scheduler true; then
      return 0
    fi
    sleep 3
  done
  section_fail "core platform services did not become healthy within ${READY_TIMEOUT_SECONDS}s"
  return 1
}

check_db_readiness() {
  section_begin "DB readiness"
  if ! service_ok postgres true; then
    section_fail "postgres service not healthy"
    return 1
  fi
  local db_identity
  db_identity="$(sql_scalar "SELECT current_user || ':' || current_database()")"
  if [[ "$db_identity" == "gdc:gdc" ]]; then
    section_ok "PostgreSQL identity $db_identity on 127.0.0.1:${PLATFORM_PG_PORT}"
  else
    section_fail "DB identity mismatch: expected gdc:gdc, got ${db_identity:-<empty>}"
  fi
}

check_alembic_revision() {
  section_begin "Alembic revision"
  local rev_line
  if ! rev_line="$(alembic_head_check 2>&1)"; then
    section_fail "Alembic not at head: ${rev_line:-unknown}"
    return 1
  fi
  section_ok "$rev_line"
}

check_api_health() {
  section_begin "API health"
  local health_json
  if ! health_json="$(curl_json "$API_ROOT/health" 2>&1)"; then
    section_fail "API /health unreachable at $API_ROOT"
    return 1
  fi
  if printf '%s' "$health_json" | json_check "/health delivery log indexes" "body.get('delivery_logs_indexes', {}).get('ok') is True" 2>/dev/null; then
    section_ok "API /health OK ($API_ROOT/health)"
  else
    section_fail "API /health response failed delivery_logs_indexes check"
  fi
  if curl -fsS --max-time 8 "$ENTRY_ROOT/health" >/dev/null 2>&1; then
    section_ok "reverse proxy /health OK ($ENTRY_ROOT/health)"
  else
    section_fail "reverse proxy health failed at $ENTRY_ROOT/health"
  fi
}

check_scheduler_health() {
  section_begin "Scheduler health"
  local health name="${GDC_SCHEDULER_CONTAINER_NAME:-gdc-platform-scheduler}"
  if service_ok scheduler true; then
    section_ok "compose service scheduler is healthy"
  else
    section_fail "compose service scheduler is not running/healthy"
  fi
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$name" 2>/dev/null || echo missing)"
  if [[ "$health" == "healthy" ]]; then
    section_ok "container $name health=$health"
  else
    section_fail "container $name health=$health (expected healthy)"
  fi
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
  missing="$(printf '%s\n' "$rows" | tr ' ' '\n' | awk -F= '$2 == "0" {print $1}' | tr '\n' ' ')"
  if [[ -z "${missing// }" ]]; then
    section_ok "dev validation source types: $rows"
    echo "$rows"
  else
    section_fail "missing [DEV VALIDATION] streams for: $missing (counts: $rows)"
    echo "$rows"
  fi
}

check_pytest_catalog_leaks() {
  section_begin "Pytest catalog leaks"
  local leak_count
  leak_count="$(sql_scalar "SELECT COUNT(*) FROM connectors WHERE name IN ('e2e-connector','s3-e2e-connector')")"
  if [[ "$leak_count" =~ ^[0-9]+$ ]] && (( leak_count == 0 )); then
    section_ok "no legacy pytest connector leaks"
  else
    section_fail "found ${leak_count:-?} legacy pytest connectors (run scripts/dev-validation/cleanup-pytest-catalog-leaks.sh)"
  fi
}

check_dev_validation_fixture_network() {
  section_begin "Dev validation fixture network"
  local api_cid
  api_cid="$("${COMPOSE[@]}" ps -q api 2>/dev/null || true)"
  if [[ -z "$api_cid" ]]; then
    section_fail "api container not running (required for fixture DNS checks)"
    return 1
  fi
  if ! docker network inspect "$DEV_VALIDATION_NET" >/dev/null 2>&1; then
    section_fail "network $DEV_VALIDATION_NET missing (run ./scripts/dev/bootstrap-dev-platform.sh)"
    return 1
  fi
  if ! docker network inspect "$DEV_VALIDATION_NET" --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null \
    | grep -qF 'gdc-platform-api'; then
    section_fail "gdc-platform-api not attached to $DEV_VALIDATION_NET (S3/DB/SFTP E2E streams cannot poll; run bootstrap or: docker network connect $DEV_VALIDATION_NET gdc-platform-api && docker compose -f docker-compose.platform.yml -f docker-compose.platform.dev-validation.yml restart api)"
    return 1
  fi
  if docker exec gdc-platform-api getent hosts gdc-postgres-query-test >/dev/null 2>&1 \
    && docker exec gdc-platform-api getent hosts gdc-minio-test >/dev/null 2>&1; then
    section_ok "api resolves fixture hosts on $DEV_VALIDATION_NET"
  else
    section_fail "api cannot resolve gdc-postgres-query-test / gdc-minio-test (check $DEV_VALIDATION_NET membership)"
  fi
}

check_dev_validation_fixtures() {
  section_begin "Dev validation fixtures"
  local connector_count stream_count
  connector_count="$(sql_scalar "SELECT count(*) FROM connectors")"
  stream_count="$(sql_scalar "SELECT count(*) FROM streams")"
  if [[ "$connector_count" =~ ^[0-9]+$ ]] && (( connector_count > 0 )); then
    section_ok "connectors=$connector_count"
  else
    section_fail "connector count is zero"
  fi
  if [[ "$stream_count" =~ ^[0-9]+$ ]] && (( stream_count > 0 )); then
    section_ok "streams=$stream_count"
  else
    section_fail "stream count is zero"
  fi
  dev_validation_source_counts_check >/dev/null
}

check_e2e_visible_fixtures() {
  section_begin "E2E visible fixtures"
  local dev_e2e_stream_count
  dev_e2e_stream_count="$(sql_scalar "SELECT count(*) FROM streams WHERE name LIKE '[DEV E2E] %'")"
  if [[ "$dev_e2e_stream_count" =~ ^[0-9]+$ ]] && (( dev_e2e_stream_count >= 5 )); then
    section_ok "[DEV E2E] streams=$dev_e2e_stream_count (expected >= 5)"
  else
    section_fail "missing UI-visible [DEV E2E] streams (got ${dev_e2e_stream_count:-0}; run bootstrap-dev-platform.sh)"
  fi
}

check_topology_visibility() {
  section_begin "Topology visibility"
  local route_count destination_count
  route_count="$(sql_scalar "SELECT count(*) FROM routes")"
  destination_count="$(sql_scalar "SELECT count(*) FROM destinations")"
  if [[ "$route_count" =~ ^[0-9]+$ ]] && (( route_count > 0 )); then
    section_ok "routes=$route_count"
  else
    section_fail "route count is zero"
  fi
  if [[ "$destination_count" =~ ^[0-9]+$ ]] && (( destination_count > 0 )); then
    section_ok "destinations=$destination_count"
  else
    section_fail "destination count is zero"
  fi
}

check_pytest_db_readiness() {
  section_begin "pytest DB readiness"
  local ontology_container="${GDC_ONTOLOGY_TEST_CONTAINER_PREFIX:-gdc}-postgres-ontology-test"
  local smoke_container="${GDC_TEST_CONTAINER_PREFIX:-gdc-smoke}-postgres-test"

  if container_healthy "$ontology_container"; then
    section_ok "$ontology_container healthy (127.0.0.1:55440)"
  else
    section_fail "$ontology_container not healthy (start: ./scripts/testing/start-test-stack.sh)"
  fi
  if container_healthy "$smoke_container"; then
    section_ok "$smoke_container healthy (127.0.0.1:55441)"
  else
    section_fail "$smoke_container not healthy (start: ./scripts/testing/start-test-stack.sh)"
  fi

  ONTOLOGY_TEST_DATABASE_URL="$ONTOLOGY_TEST_URL" SMOKE_TEST_DATABASE_URL="$SMOKE_TEST_URL" python3 - <<'PY' || section_fail "pytest catalog connectivity check failed"
import os
import sys
from sqlalchemy import create_engine, text

checks = [
    ("ontology", os.environ["ONTOLOGY_TEST_DATABASE_URL"], "gdc_ontology_test"),
    ("smoke", os.environ["SMOKE_TEST_DATABASE_URL"], "gdc_pytest"),
]
for label, url, expected_db in checks:
    engine = create_engine(url, pool_pre_ping=True)
    try:
        with engine.connect() as conn:
            db = conn.execute(text("select current_database()")).scalar_one()
            if db != expected_db:
                raise SystemExit(f"{label}: connected to {db!r}, expected {expected_db!r}")
    finally:
        engine.dispose()
    print(f"  OK: {label} catalog connectivity ({expected_db})")
PY
}

wait_for_delivery_logs() {
  local count stream_id admin_token="$1"
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
  [[ "$stream_id" =~ ^[0-9]+$ ]] || section_fail "delivery_logs empty and no [DEV VALIDATION] stream" && return 1
  echo "  triggering run-once for stream_id=$stream_id" >&2
  curl -fsS --max-time 60 -X POST -H "Authorization: Bearer $admin_token" \
    "$API_ROOT/api/v1/runtime/streams/$stream_id/run-once" >/dev/null

  for _ in $(seq 1 20); do
    count="$(sql_scalar "SELECT count(*) FROM delivery_logs")"
    if [[ "$count" =~ ^[0-9]+$ ]] && (( count > 0 )); then
      echo "$count"
      return 0
    fi
    sleep 2
  done
  section_fail "delivery_logs still empty after run-once"
  return 1
}

run_authenticated_runtime_checks() {
  local admin_token="$1"
  local delivery_logs_count analytics_summary
  section_begin "Authenticated runtime API checks"
  local runtime_status
  if ! runtime_status="$(curl_json_auth "$admin_token" "$API_ROOT/api/v1/runtime/status" 2>&1)"; then
    section_fail "runtime /status unreachable"
    return 1
  fi
  if printf '%s' "$runtime_status" | json_check "runtime status" "body.get('schema_ready') is True and body.get('scheduler_active') is True" 2>/dev/null; then
    section_ok "runtime status schema_ready and scheduler_active"
  else
    section_fail "runtime status check failed"
  fi

  delivery_logs_count="$(wait_for_delivery_logs "$admin_token" || echo 0)"
  if [[ "$delivery_logs_count" =~ ^[0-9]+$ ]] && (( delivery_logs_count > 0 )); then
    section_ok "delivery_logs count=$delivery_logs_count"
  fi

  local dashboard_json logs_json analytics_json
  dashboard_json="$(curl_json_auth "$admin_token" "$API_ROOT/api/v1/runtime/dashboard/summary?window=24h&limit=100")"
  printf '%s' "$dashboard_json" | json_check "runtime dashboard" "body.get('summary', {}).get('recent_logs', 0) > 0" 2>/dev/null \
    && section_ok "runtime dashboard has recent_logs"

  logs_json="$(curl_json_auth "$admin_token" "$API_ROOT/api/v1/runtime/logs/search?limit=20")"
  printf '%s' "$logs_json" | json_check "logs explorer" "body.get('total_returned', 0) > 0" 2>/dev/null \
    && section_ok "logs explorer non-empty"

  analytics_json="$(curl_json_auth "$admin_token" "$API_ROOT/api/v1/runtime/analytics/delivery-outcomes/destinations?window=24h")"
  analytics_summary="$(printf '%s' "$analytics_json" | json_value "[(row.get('destination_id'), row.get('success_events', 0), row.get('failure_events', 0)) for row in body.get('rows', [])]")"
  section_ok "analytics sample: $analytics_summary"
}

require_cmd docker
require_cmd curl
require_cmd python3

parse_args "$@"
resolve_admin_password

echo "GDC development platform readiness validation"
echo "  Contract: docs/dev/dev-platform-environment-contract.md"

check_compose_status
wait_for_core_services || true
check_db_readiness
check_alembic_revision
check_api_health
check_scheduler_health

section_begin "Admin auth"
validate_admin_authentication
admin_token="$ADMIN_LOGIN_TOKEN"

check_pytest_catalog_leaks
check_dev_validation_fixture_network
check_dev_validation_fixtures
check_e2e_visible_fixtures
check_topology_visibility
check_pytest_db_readiness

if [[ "$AUTH_RUNTIME_CHECKS" == "true" && -n "$admin_token" ]]; then
  run_authenticated_runtime_checks "$admin_token"
elif [[ "$CREDENTIAL_DRIFT" == "true" ]]; then
  section_begin "Authenticated runtime API checks"
  section_warn "skipped (credential drift; non-auth checks above still ran)"
elif [[ "$ADMIN_LOGIN_RESULT" == "password_change_required" ]]; then
  section_begin "Authenticated runtime API checks"
  section_warn "skipped (password change required)"
else
  section_begin "Authenticated runtime API checks"
  section_warn "skipped (--skip-auth-check or no token)"
fi

echo ""
echo "=== Summary ==="
if [[ "$HARD_FAIL" -gt 0 ]]; then
  echo "  Result: FAIL (hard failures present)"
  exit 1
fi
if [[ "$WARN_COUNT" -gt 0 ]]; then
  echo "  Result: PASS with warnings ($WARN_COUNT)"
  if [[ "$CREDENTIAL_DRIFT" == "true" ]]; then
    echo "  Note: admin credential drift — set GDC_VALIDATE_ADMIN_PASSWORD or run reset-admin-password.sh"
  fi
  exit 0
fi
echo "  Result: PASS"
exit 0
