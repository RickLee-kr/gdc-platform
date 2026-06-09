#!/usr/bin/env bash
# RH-05: AI Gateway WireMock operational soak (timeout, retry, failover).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="${GDC_RELEASE_COMPOSE_FILE:-$ROOT/docker-compose.platform.yml}"

WIREMOCK_HOST="${WIREMOCK_HOST:-gdc-wiremock-test}"
WIREMOCK_PORT="${WIREMOCK_PORT:-8080}"
WIREMOCK_BASE_URL="${WIREMOCK_BASE_URL:-http://${WIREMOCK_HOST}:${WIREMOCK_PORT}}"

echo "WireMock soak target: ${WIREMOCK_BASE_URL}" >&2

if ! docker compose -f "$COMPOSE_FILE" ps --status running gdc-wiremock-test 2>/dev/null | grep -q gdc-wiremock-test; then
  echo "FAIL: gdc-wiremock-test container is not running" >&2
  exit 1
fi

# Reachability probe from a disposable container on the compose network.
docker compose -f "$COMPOSE_FILE" run --rm --no-deps \
  -e WIREMOCK_BASE_URL="$WIREMOCK_BASE_URL" \
  -e DATABASE_URL="${TEST_DATABASE_URL:-postgresql://gdc:gdc@postgres:5432/gdc_pytest}" \
  -e TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://gdc:gdc@postgres:5432/gdc_pytest}" \
  -v "$ROOT:/workspace:ro" \
  --entrypoint sh api -c '
    set -e
    pip install -q pytest httpx 2>/dev/null || true
    cd /workspace
    python -m pytest \
      tests/test_ai_provider_e2e_wiremock.py \
      tests/test_ai_failover_e2e.py::test_ai_provider_failover_primary_500_secondary_mock \
      tests/test_ai_failover_e2e.py::test_failover_eligible_for_ai_provider_timeout \
      -q --tb=line
  '
