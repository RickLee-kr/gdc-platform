#!/usr/bin/env bash
# Post-install verification for air-gapped Data Relay deployments.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/_common.sh
source "$SCRIPT_DIR/../scripts/_common.sh"

OFFLINE_PACKAGE_ROOT="$(offline_resolve_package_root "$SCRIPT_DIR")"
export OFFLINE_PACKAGE_ROOT

PORT="$(offline_http_port)"
HTTP_BASE="http://127.0.0.1:${PORT}"

failures=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }

echo "============================================================"
echo "Data Relay — offline install verification"
echo "============================================================"
echo "Package: $OFFLINE_PACKAGE_ROOT"
echo "HTTP:    $HTTP_BASE"
echo ""

echo "--- Docker containers ---"
for svc in postgres api frontend reverse-proxy; do
  cid="$(offline_compose ps -q "$svc" 2>/dev/null || true)"
  if [[ -z "$cid" ]]; then
    fail "container missing: $svc"
    continue
  fi
  running="$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || echo false)"
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' "$cid" 2>/dev/null || echo unknown)"
  if [[ "$running" == "true" ]]; then
    pass "container $svc running (health=$health)"
  else
    fail "container $svc not running"
  fi
done

echo ""
echo "--- API health (via reverse proxy) ---"
if command -v curl >/dev/null 2>&1; then
  if curl -fsS "${HTTP_BASE}/health" >/dev/null 2>&1; then
    pass "GET ${HTTP_BASE}/health"
  else
    fail "GET ${HTTP_BASE}/health"
  fi
else
  echo "SKIP  curl not installed"
fi

echo ""
echo "--- API health (inside api container) ---"
if offline_compose exec -T api wget -qO- http://127.0.0.1:8000/health >/dev/null 2>&1; then
  pass "GET http://127.0.0.1:8000/health (api container)"
else
  fail "GET http://127.0.0.1:8000/health (api container)"
fi

echo ""
echo "--- Frontend (reverse proxy root) ---"
if command -v curl >/dev/null 2>&1; then
  code="$(curl -sS -o /dev/null -w '%{http_code}' "${HTTP_BASE}/" 2>/dev/null || echo 000)"
  if [[ "$code" == "200" || "$code" == "304" ]]; then
    pass "GET ${HTTP_BASE}/ (HTTP $code)"
  else
    fail "GET ${HTTP_BASE}/ (HTTP $code)"
  fi
else
  echo "SKIP  curl not installed"
fi

echo ""
echo "--- Database connectivity ---"
PG_USER="$(offline_read_env POSTGRES_USER)"
PG_DB="$(offline_read_env POSTGRES_DB)"
[[ -n "$PG_USER" ]] || PG_USER=gdc
[[ -n "$PG_DB" ]] || PG_DB=gdc
if offline_compose exec -T postgres pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
  pass "postgres pg_isready -U $PG_USER -d $PG_DB"
else
  fail "postgres pg_isready"
fi

echo ""
echo "--- Runtime API smoke ---"
if command -v curl >/dev/null 2>&1; then
  for path in \
    "/api/v1/runtime/status" \
    "/api/v1/streams" \
    "/api/v1/connectors"; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${HTTP_BASE}${path}" 2>/dev/null || echo 000)"
    # Unauthenticated catalog reads may return 401 when REQUIRE_AUTH=true — still proves routing.
    if [[ "$code" =~ ^(200|401|403)$ ]]; then
      pass "GET ${path} (HTTP $code)"
    else
      fail "GET ${path} (HTTP $code)"
    fi
  done

  echo ""
  echo "--- Auth login ---"
  pw="$(offline_read_env GDC_SEED_ADMIN_PASSWORD)"
  [[ -n "$pw" ]] || pw="admin"
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
    pass "POST /api/v1/auth/login"
  else
    fail "POST /api/v1/auth/login (HTTP $login_code)"
  fi
else
  echo "SKIP  runtime/auth checks (curl not installed)"
fi

echo ""
if [[ "$failures" -eq 0 ]]; then
  echo "Verification OK — all checks passed."
  exit 0
fi

echo "Verification FAILED — $failures check(s) failed."
echo "Logs: docker compose -f configs/docker-compose.offline.yml --env-file configs/.env logs"
exit 1
