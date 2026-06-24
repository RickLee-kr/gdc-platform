#!/usr/bin/env bash
# Post-install verification for air-gapped Data Relay deployments.
# Run standalone: checks/verify-install.sh
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/_common.sh
source "$SCRIPT_DIR/../scripts/_common.sh"

OFFLINE_PACKAGE_ROOT="$(offline_resolve_package_root "$SCRIPT_DIR")"
export OFFLINE_PACKAGE_ROOT

PORT="$(offline_http_port)"
HTTP_BASE="$(offline_http_base_url)"
COMPOSE_PROJECT="$(offline_compose_project_name)"

FAILURES=0
CHECKS_RUN=0

pass() {
  CHECKS_RUN=$((CHECKS_RUN + 1))
  echo "PASS  $1"
}

fail() {
  local msg="$1"
  local hint="${2:-}"
  CHECKS_RUN=$((CHECKS_RUN + 1))
  FAILURES=$((FAILURES + 1))
  echo "FAIL  $msg"
  if [[ -n "$hint" ]]; then
    echo "      hint: $hint"
  fi
}

skip() {
  echo "SKIP  $1"
}

section() {
  echo ""
  echo "--- $1 ---"
}

usage() {
  cat <<'EOF'
Usage: verify-install.sh

Validates an offline Data Relay install (containers, DB, migrations, API, UI, admin).
Exit 0 when all checks pass; exit 1 on any failure.

Run from the extracted offline-release directory after install-offline.sh.
EOF
}

[[ "${1:-}" != "-h" && "${1:-}" != "--help" ]] || { usage; exit 0; }

[[ -f "$(offline_compose_file)" ]] || fail "compose file missing" "Run from extracted offline-release package"
[[ -f "$(offline_env_file)" ]] || fail "configs/.env missing" "Copy configs/.env.production.template to configs/.env"

echo "============================================================"
echo "Data Relay — offline install verification"
echo "============================================================"
echo "Package:  $OFFLINE_PACKAGE_ROOT"
echo "Project:  $COMPOSE_PROJECT"
echo "HTTP:     $HTTP_BASE"
echo "Time:     $(offline_ts)"

# --- 1. Container status ---
section "Container status"
EXPECTED_CONTAINERS=(gdc-platform-postgres gdc-platform-api gdc-platform-frontend gdc-platform-reverse-proxy)
for name in "${EXPECTED_CONTAINERS[@]}"; do
  if ! docker inspect "$name" >/dev/null 2>&1; then
    fail "container not found: $name" "docker compose -f configs/docker-compose.offline.yml --env-file configs/.env ps -a"
    continue
  fi
  running="$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || echo false)"
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' "$name" 2>/dev/null || echo unknown)"
  if [[ "$running" != "true" ]]; then
    fail "container not running: $name" "docker logs $name"
    continue
  fi
  if [[ "$health" == "unhealthy" ]]; then
    fail "container unhealthy: $name (health=$health)" "docker logs $name"
  elif [[ "$health" == "healthy" || "$health" == "n/a" ]]; then
    pass "container $name running (health=$health)"
  else
    fail "container $name running but health=$health" "wait for healthcheck or: docker logs $name"
  fi
done

# --- 2. Database connectivity ---
section "Database connectivity"
PG_USER="$(offline_read_env POSTGRES_USER)"
PG_DB="$(offline_read_env POSTGRES_DB)"
[[ -n "$PG_USER" ]] || PG_USER=gdc
[[ -n "$PG_DB" ]] || PG_DB=gdc

if offline_compose exec -T postgres pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
  pass "postgres pg_isready -U $PG_USER -d $PG_DB"
else
  fail "postgres pg_isready failed" "docker logs gdc-platform-postgres"
fi

db_query_out="$(offline_compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc 'SELECT 1' 2>/dev/null | tr -d '[:space:]' || true)"
if [[ "$db_query_out" == "1" ]]; then
  pass "postgres SELECT 1"
else
  fail "postgres SELECT 1 failed (got: ${db_query_out:-<empty>})" "docker logs gdc-platform-postgres; check POSTGRES_* in configs/.env"
fi

# --- 3. Migration status ---
section "Migration status (Alembic)"
alembic_db="$(offline_compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc 'SELECT version_num FROM alembic_version LIMIT 1' 2>/dev/null | tr -d '[:space:]' || true)"
if [[ -n "$alembic_db" ]]; then
  pass "alembic_version row present (revision=$alembic_db)"
else
  fail "alembic_version table empty or missing" "docker compose run --rm --no-deps api alembic upgrade head"
fi

alembic_current="$(offline_compose exec -T api alembic current 2>/dev/null | tail -n 1 | tr -d '[:space:]' || true)"
if [[ -n "$alembic_current" ]]; then
  pass "alembic current reports revision ($alembic_current)"
else
  fail "alembic current returned no revision" "docker logs gdc-platform-api"
fi

mig_log="$(mktemp)"
set +e
offline_compose exec -T api python -m app.db.validate_migrations --strict >"$mig_log" 2>&1
mig_rc=$?
set -e
if [[ "$mig_rc" -eq 0 ]]; then
  pass "validate_migrations --strict (DB matches migration head)"
elif [[ "$mig_rc" -eq 3 ]]; then
  fail "validate_migrations warnings" "see: docker compose exec api python -m app.db.validate_migrations --strict"
  tail -n 5 "$mig_log" | sed 's/^/      /'
else
  fail "validate_migrations failed (exit $mig_rc)" "docker compose exec api alembic upgrade head"
  tail -n 8 "$mig_log" | sed 's/^/      /'
fi
rm -f "$mig_log"

# --- 4. API health ---
section "API health"
if offline_compose exec -T api wget -qO- http://127.0.0.1:8000/health >/dev/null 2>&1; then
  pass "GET http://127.0.0.1:8000/health (inside api container)"
else
  fail "API health inside container" "docker logs gdc-platform-api"
fi

if command -v curl >/dev/null 2>&1; then
  proxy_health="$(curl -fsS "${HTTP_BASE}/health" 2>/dev/null || true)"
  if [[ -n "$proxy_health" ]]; then
    pass "GET ${HTTP_BASE}/health (via reverse proxy)"
  else
    fail "GET ${HTTP_BASE}/health via reverse proxy" "docker logs gdc-platform-reverse-proxy; curl -v ${HTTP_BASE}/health"
  fi
else
  skip "proxy health (curl not installed on host)"
fi

# --- 5. Frontend response ---
section "Frontend response"
if command -v curl >/dev/null 2>&1; then
  root_code="$(curl -sS -o /dev/null -w '%{http_code}' "${HTTP_BASE}/" 2>/dev/null || echo 000)"
  if [[ "$root_code" == "200" || "$root_code" == "304" ]]; then
    pass "GET ${HTTP_BASE}/ (HTTP $root_code)"
  else
    fail "GET ${HTTP_BASE}/ (HTTP $root_code)" "docker logs gdc-platform-frontend; docker logs gdc-platform-reverse-proxy"
  fi
  asset_code="$(curl -sS -o /dev/null -w '%{http_code}' "${HTTP_BASE}/index.html" 2>/dev/null || echo 000)"
  if [[ "$asset_code" == "200" || "$asset_code" == "304" ]]; then
    pass "GET ${HTTP_BASE}/index.html (HTTP $asset_code)"
  else
    fail "GET ${HTTP_BASE}/index.html (HTTP $asset_code)" "frontend bundle may be missing — rebuild offline package images"
  fi
else
  skip "frontend HTTP checks (curl not installed on host)"
  if offline_compose exec -T frontend wget -qO- http://127.0.0.1/ >/dev/null 2>&1; then
    pass "GET / inside frontend container"
  else
    fail "frontend container root unreachable" "docker logs gdc-platform-frontend"
  fi
fi

# --- 6. Platform administrator account ---
section "Platform administrator account"
admin_row="$(offline_compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT username || '|' || role || '|' || status || '|' || must_change_password::text FROM platform_users WHERE username='admin' LIMIT 1" \
  2>/dev/null | tr -d '[:space:]' || true)"
if [[ -n "$admin_row" ]]; then
  IFS='|' read -r admin_user admin_role admin_status admin_mcp <<<"$admin_row"
  if [[ "$admin_status" == "ACTIVE" ]]; then
    pass "platform_users admin row exists (role=${admin_role:-?}, must_change_password=${admin_mcp:-?})"
  else
    fail "admin user status=$admin_status (expected ACTIVE)" "docker compose run --rm --no-deps api python -m app.db.seed --platform-admin-only"
  fi
else
  fail "platform_users admin row missing" "docker compose run --rm --no-deps api python -m app.db.seed --platform-admin-only"
fi

# --- 7. Auth login ---
section "Authentication"
if command -v curl >/dev/null 2>&1; then
  pw="$(offline_resolve_admin_password)"
  payload="$(python3 - "$pw" <<'PY'
import json, sys
print(json.dumps({"username": "admin", "password": sys.argv[1]}))
PY
)"
  login_code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
    "${HTTP_BASE}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null || echo 000)"
  if [[ "$login_code" == "200" ]]; then
    pass "POST /api/v1/auth/login (admin)"
  else
    fail "POST /api/v1/auth/login (HTTP $login_code)" "check GDC_SEED_ADMIN_PASSWORD; default is admin/admin on fresh install"
  fi
else
  skip "auth login (curl not installed on host)"
fi

# --- 8. Runtime API smoke ---
section "Runtime API routing"
if command -v curl >/dev/null 2>&1; then
  for path in "/api/v1/runtime/status" "/api/v1/streams" "/api/v1/connectors"; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${HTTP_BASE}${path}" 2>/dev/null || echo 000)"
    if [[ "$code" =~ ^(200|401|403)$ ]]; then
      pass "GET ${path} (HTTP $code)"
    else
      fail "GET ${path} (HTTP $code)" "docker logs gdc-platform-api; docker logs gdc-platform-reverse-proxy"
    fi
  done
else
  skip "runtime API smoke (curl not installed on host)"
fi

# --- Summary ---
echo ""
echo "============================================================"
if [[ "$FAILURES" -eq 0 ]]; then
  echo "Verification OK — ${CHECKS_RUN} check(s) passed."
  echo "============================================================"
  exit 0
fi

echo "Verification FAILED — $FAILURES of ${CHECKS_RUN} check(s) failed."
echo ""
echo "Troubleshooting:"
echo "  docker compose -f configs/docker-compose.offline.yml --env-file configs/.env ps -a"
echo "  docker compose -f configs/docker-compose.offline.yml --env-file configs/.env logs -f api"
echo "  docker compose -f configs/docker-compose.offline.yml --env-file configs/.env logs -f reverse-proxy"
echo "  docker compose -f configs/docker-compose.offline.yml --env-file configs/.env logs -f postgres"
echo "  docs/offline-install-validation.md (in package) — full operator checklist"
echo "============================================================"
exit 1
