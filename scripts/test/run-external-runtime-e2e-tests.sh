#!/usr/bin/env bash
# Start fixtures, migrate gdc_pytest, run pytest -m e2e_runtime (external-service pipeline E2E).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/testing/_env.sh"

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'postgres-test'; then
  "$ROOT/scripts/testing/start-external-runtime-e2e-stack.sh"
else
  echo "==> Compose stack already running; waiting for readiness …"
  "$ROOT/scripts/testing/wait-external-services.sh"
  "$ROOT/scripts/testing/source-e2e/seed-fixtures.sh"
fi

export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://gdc:gdc@127.0.0.1:${GDC_TEST_POSTGRES_HOST_PORT}/gdc_pytest}"
export DATABASE_URL="$TEST_DATABASE_URL"
export WIREMOCK_BASE_URL="${WIREMOCK_BASE_URL:-http://127.0.0.1:28080}"
export SOURCE_E2E_MINIO_ENDPOINT="${SOURCE_E2E_MINIO_ENDPOINT:-http://127.0.0.1:59000}"
export SOURCE_E2E_PG_FIXTURE_URL="${SOURCE_E2E_PG_FIXTURE_URL:-postgresql://gdc_fixture:gdc_fixture_pw@127.0.0.1:55433/gdc_query_fixture}"
export SOURCE_E2E_SFTP_HOST="${SOURCE_E2E_SFTP_HOST:-127.0.0.1}"
export SOURCE_E2E_SFTP_PORT="${SOURCE_E2E_SFTP_PORT:-22222}"

cd "$ROOT"
python3 "$ROOT/scripts/test/ensure_gdc_pytest_catalog.py"
set +e
alembic upgrade head
set -e

MARKER="${E2E_RUNTIME_MARKER:-e2e_runtime}"
EXTRA_ARGS=()
if [ -n "${PYTEST_ARGS:-}" ]; then
  # shellcheck disable=SC2206
  EXTRA_ARGS=($PYTEST_ARGS)
fi

echo "==> pytest -m ${MARKER} tests/test_external_runtime_e2e.py …"
set +e
python3 -m pytest -m "$MARKER" tests/test_external_runtime_e2e.py -v --tb=short "${EXTRA_ARGS[@]}"
PY_EXIT=$?
set -e

if [ "$PY_EXIT" -eq 0 ]; then
  echo ""
  echo "=============================================="
  echo " EXTERNAL RUNTIME E2E: PASS"
  echo "=============================================="
else
  echo ""
  echo "=============================================="
  echo " EXTERNAL RUNTIME E2E: FAIL (exit $PY_EXIT)"
  echo "=============================================="
fi
exit "$PY_EXIT"
