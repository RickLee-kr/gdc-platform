#!/usr/bin/env bash
# Start docker-compose.test.yml fixture services, migrate, run pytest -m source_e2e.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/testing/_env.sh"

export COMPOSE_PROFILES="${COMPOSE_PROFILES:-test}"
COMPOSE_FILE="${GDC_TEST_COMPOSE_FILE:-$ROOT/docker-compose.test.yml}"

echo "==> Starting test stack (postgres, wiremock, webhook echo, syslog, minio, fixture PG, SFTP) …"
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
    echo "ERROR: postgres-test did not become healthy."
    docker compose -f "$COMPOSE_FILE" logs --tail 80 postgres-test || true
    exit 1
  fi
done

echo "==> Waiting for WireMock TCP …"
for i in $(seq 1 40); do
  if curl -sf "${WIREMOCK_BASE_URL:-http://127.0.0.1:28080}/__admin/mappings" >/dev/null; then
    break
  fi
  sleep 1
  if [ "$i" -eq 40 ]; then
    echo "ERROR: WireMock not reachable at ${WIREMOCK_BASE_URL:-http://127.0.0.1:28080}"
    exit 1
  fi
done

echo "==> Ensure pytest catalog …"
python3 "$ROOT/scripts/test/ensure_gdc_pytest_catalog.py"

sleep 2
echo "==> Seeding MinIO / fixture DB / SFTP …"
"$ROOT/scripts/testing/source-e2e/seed-fixtures.sh"

export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://gdc:gdc@127.0.0.1:55432/gdc_pytest}"
export DATABASE_URL="$TEST_DATABASE_URL"
export WIREMOCK_BASE_URL="${WIREMOCK_BASE_URL:-http://127.0.0.1:28080}"
export SOURCE_E2E_MINIO_ENDPOINT="${SOURCE_E2E_MINIO_ENDPOINT:-http://127.0.0.1:59000}"
export SOURCE_E2E_PG_FIXTURE_URL="${SOURCE_E2E_PG_FIXTURE_URL:-postgresql://gdc_fixture:gdc_fixture_pw@127.0.0.1:55433/gdc_query_fixture}"
export SOURCE_E2E_SFTP_HOST="${SOURCE_E2E_SFTP_HOST:-127.0.0.1}"
export SOURCE_E2E_SFTP_PORT="${SOURCE_E2E_SFTP_PORT:-22222}"

cd "$ROOT"
echo "==> Alembic upgrade head …"
set +e
alembic upgrade head
AL_EXIT=$?
set -e
if [ "$AL_EXIT" != 0 ]; then
  echo "WARN: alembic upgrade head exited $AL_EXIT (schema may already exist; conftest will still ensure tables)."
fi

echo "==> pytest -m source_e2e …"
set +e
pytest -m source_e2e tests/test_source_adapter_e2e.py -v --tb=short
PY_EXIT=$?
set -e

echo "==> docker compose config validation …"
docker compose -f "$COMPOSE_FILE" config >/dev/null
echo "docker compose config: OK"

if [ "$PY_EXIT" -eq 0 ]; then
  echo ""
  echo "=============================================="
  echo " SOURCE ADAPTER E2E: PASS"
  echo "=============================================="
else
  echo ""
  echo "=============================================="
  echo " SOURCE ADAPTER E2E: FAIL (exit $PY_EXIT)"
  echo "=============================================="
fi

exit "$PY_EXIT"
