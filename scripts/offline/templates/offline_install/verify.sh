#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.offline.yml"
ENV_FILE="$SCRIPT_DIR/.env"
LOG_FILE=""

REQUIRED_IMAGES=(
  "postgres:16-alpine"
  "gdc-platform-api:offline"
  "gdc-platform-frontend:offline"
  "gdc-platform-reverse-proxy:offline"
)

FAILURES=0
CHECKS=0
CATEGORY_DOCKER=PASS
CATEGORY_COMPOSE=PASS
CATEGORY_IMAGES=PASS
CATEGORY_DATABASE=PASS
CATEGORY_MIGRATION=PASS
CATEGORY_API_HEALTH=PASS
CATEGORY_FRONTEND=PASS
FAILED_CATEGORIES=()

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

ts() { date '+%Y-%m-%d %H:%M:%S'; }

init_logging() {
  local log_dir="$SCRIPT_DIR/logs"
  mkdir -p "$log_dir"
  LOG_FILE="$log_dir/verify-$(date +%Y%m%d-%H%M%S).log"
  exec > >(tee -a "$LOG_FILE") 2>&1
  echo "[$(ts)] Logging to $LOG_FILE"
}

mark_failed_category() {
  local category="$1"
  case "$category" in
    "Docker") CATEGORY_DOCKER=FAIL ;;
    "Docker Compose") CATEGORY_COMPOSE=FAIL ;;
    "Images") CATEGORY_IMAGES=FAIL ;;
    "Database") CATEGORY_DATABASE=FAIL ;;
    "Migration") CATEGORY_MIGRATION=FAIL ;;
    "API Health") CATEGORY_API_HEALTH=FAIL ;;
    "Frontend") CATEGORY_FRONTEND=FAIL ;;
    *) return 0 ;;
  esac
  if [[ " ${FAILED_CATEGORIES[*]} " != *" ${category} "* ]]; then
    FAILED_CATEGORIES+=("$category")
  fi
}

pass() {
  CHECKS=$((CHECKS + 1))
  echo "PASS  $1"
}

fail() {
  local category="${2:-}"
  CHECKS=$((CHECKS + 1))
  FAILURES=$((FAILURES + 1))
  echo "FAIL  $1"
  [[ -n "$category" ]] && mark_failed_category "$category"
}

require_file() {
  [[ -f "$1" ]] || { echo "ERROR: missing file $1" >&2; exit 1; }
}

init_logging

echo "============================================================"
echo "Data Relay offline verify"
echo "============================================================"

require_file "$COMPOSE_FILE"
require_file "$ENV_FILE"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  pass "docker daemon reachable"
else
  fail "docker daemon not reachable" "Docker"
fi

if docker compose version >/dev/null 2>&1; then
  pass "docker compose plugin detected"
else
  fail "docker compose plugin not detected" "Docker Compose"
fi

echo ""
echo "--- Container status ---"
for c in gdc-platform-postgres gdc-platform-api gdc-platform-frontend gdc-platform-reverse-proxy; do
  if docker inspect "$c" >/dev/null 2>&1 && [[ "$(docker inspect -f '{{.State.Running}}' "$c")" == "true" ]]; then
    pass "$c running"
  else
    fail "$c not running"
  fi
done

echo ""
echo "--- Docker images ---"
for ref in "${REQUIRED_IMAGES[@]}"; do
  if docker image inspect "$ref" >/dev/null 2>&1; then
    pass "image present: $ref"
  else
    fail "image missing: $ref" "Images"
  fi
done

echo ""
echo "--- DB connection ---"
if compose exec -T postgres pg_isready -U gdc -d gdc >/dev/null 2>&1; then
  pass "postgres pg_isready"
else
  fail "postgres pg_isready" "Database"
fi

if compose exec -T postgres psql -U gdc -d gdc -tAc "SELECT 1" 2>/dev/null | tr -d '[:space:]' | awk '{exit !($1=="1")}'; then
  pass "postgres SELECT 1"
else
  fail "postgres SELECT 1" "Database"
fi

echo ""
echo "--- Migration status ---"
if compose exec -T postgres psql -U gdc -d gdc -tAc "SELECT version_num FROM alembic_version LIMIT 1" 2>/dev/null | awk 'NF{found=1} END{exit !found}'; then
  pass "alembic_version present"
else
  fail "alembic_version missing" "Migration"
fi

if compose exec -T api python -m app.db.validate_migrations --strict >/dev/null 2>&1; then
  pass "validate_migrations --strict"
else
  fail "validate_migrations --strict" "Migration"
fi

echo ""
echo "--- API / Frontend checks ---"
if curl -fsS "http://127.0.0.1:18080/health" >/dev/null 2>&1; then
  pass "API health via 18080"
else
  fail "API health via 18080" "API Health"
fi

if curl -fsS "http://127.0.0.1:18080/" >/dev/null 2>&1; then
  pass "Frontend response on 18080"
else
  fail "Frontend response on 18080" "Frontend"
fi

if curl -fsS "http://127.0.0.1:18080/login" >/dev/null 2>&1; then
  pass "Login page response"
else
  fail "Login page response" "Frontend"
fi

for path in /api/v1/runtime/status /api/v1/streams /api/v1/connectors; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:18080${path}" || echo 000)"
  if [[ "$code" == "200" || "$code" == "401" || "$code" == "403" ]]; then
    pass "Major API response ${path} (HTTP ${code})"
  else
    fail "Major API response ${path} (HTTP ${code})" "API Health"
  fi
done

echo ""
echo "===================================================="
echo "Data Relay Installation Summary"
echo "===================================================="
echo ""
printf '%-20s %s\n' "Docker" "$CATEGORY_DOCKER"
printf '%-20s %s\n' "Docker Compose" "$CATEGORY_COMPOSE"
printf '%-20s %s\n' "Images" "$CATEGORY_IMAGES"
printf '%-20s %s\n' "Database" "$CATEGORY_DATABASE"
printf '%-20s %s\n' "Migration" "$CATEGORY_MIGRATION"
printf '%-20s %s\n' "API Health" "$CATEGORY_API_HEALTH"
printf '%-20s %s\n' "Frontend" "$CATEGORY_FRONTEND"
echo ""
echo "Access URL"
echo "http://<운영서버IP>:18080/"
echo ""
echo "Result"

if [[ "$FAILURES" -eq 0 ]]; then
  echo "INSTALLATION SUCCESS"
  echo "===================================================="
  exit 0
fi

echo "INSTALLATION FAILED"
echo ""
echo "Failed Checks"
if [[ "${#FAILED_CATEGORIES[@]}" -eq 0 ]]; then
  echo " - Unknown"
else
  for category in "${FAILED_CATEGORIES[@]}"; do
    echo " - ${category}"
  done
fi
echo ""
echo "See:"
echo "offline_install/logs/install-*.log"
echo "offline_install/logs/verify-*.log"
echo "===================================================="
exit 1
