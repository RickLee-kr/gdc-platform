#!/usr/bin/env bash
# Start all Docker fixtures for external runtime E2E and wait until ready.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/testing/_env.sh"
cd "$ROOT"

export COMPOSE_PROFILES="${COMPOSE_PROFILES:-test,e2e}"
COMPOSE_FILE="${GDC_TEST_COMPOSE_FILE:-$ROOT/docker-compose.test.yml}"

echo "==> Starting external runtime E2E stack …"
docker compose -f "$COMPOSE_FILE" up -d \
  postgres-test wiremock-test webhook-receiver-test syslog-test \
  minio-test postgres-query-test sftp-test

echo "==> Waiting for postgres-test healthy …"
for i in $(seq 1 60); do
  if docker compose -f "$COMPOSE_FILE" ps postgres-test 2>/dev/null | grep -q "healthy"; then
    break
  fi
  sleep 1
  if [ "$i" -eq 60 ]; then
    echo "ERROR: postgres-test did not become healthy." >&2
    docker compose -f "$COMPOSE_FILE" logs --tail 80 postgres-test || true
    exit 1
  fi
done

for i in $(seq 1 60); do
  if docker compose -f "$COMPOSE_FILE" ps postgres-query-test 2>/dev/null | grep -q "healthy"; then
    break
  fi
  sleep 1
  if [ "$i" -eq 60 ]; then
    echo "ERROR: postgres-query-test did not become healthy." >&2
    exit 1
  fi
done

"$ROOT/scripts/testing/wait-external-services.sh"

echo "==> Seeding fixtures …"
"$ROOT/scripts/testing/source-e2e/seed-fixtures.sh"

echo ""
echo "External runtime E2E stack is ready."
echo "  TEST_DATABASE_URL=${TEST_DATABASE_URL}"
echo "  WIREMOCK_BASE_URL=${WIREMOCK_BASE_URL}"
echo "  SOURCE_E2E_MINIO_ENDPOINT=${SOURCE_E2E_MINIO_ENDPOINT:-http://127.0.0.1:59000}"
echo "  SOURCE_E2E_PG_FIXTURE_URL=${SOURCE_E2E_PG_FIXTURE_URL:-postgresql://gdc_fixture:gdc_fixture_pw@127.0.0.1:55433/gdc_query_fixture}"
echo "  Run: ./scripts/test/run-external-runtime-e2e-tests.sh"
