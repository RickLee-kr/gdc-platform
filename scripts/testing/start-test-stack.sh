#!/usr/bin/env bash
# Start isolated test dependencies (PostgreSQL smoke + ontology catalogs, WireMock, webhook echo, syslog listener).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/testing/_env.sh"
# shellcheck source=scripts/dev-validation/lib/fixture-compose.sh
source "$ROOT/scripts/dev-validation/lib/fixture-compose.sh"
cd "$ROOT"
export COMPOSE_PROFILES=test
export GDC_ONTOLOGY_TEST_CONTAINER_PREFIX="${GDC_ONTOLOGY_TEST_CONTAINER_PREFIX:-gdc}"
PG_TEST_CONTAINER="${GDC_TEST_CONTAINER_PREFIX:-gdc}-postgres-test"
ONTOLOGY_CONTAINER="${GDC_ONTOLOGY_TEST_CONTAINER_PREFIX}-postgres-ontology-test"
export ONTOLOGY_TEST_DATABASE_URL="${ONTOLOGY_TEST_DATABASE_URL:-postgresql://gdc_ontology:gdc_ontology_pw@127.0.0.1:55440/gdc_ontology_test}"

wait_compose_healthy() {
  local container="$1"
  local deadline=$((SECONDS + 90))
  while true; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing-healthcheck{{end}}' "$container" 2>/dev/null || true)"
    if [[ "$status" == "healthy" ]]; then
      return 0
    fi
    if (( SECONDS >= deadline )); then
      echo "ERROR: $container did not become healthy (last status: ${status:-missing})." >&2
      docker compose -f "$GDC_TEST_COMPOSE_FILE" ps >&2 || true
      docker logs --tail 80 "$container" >&2 || true
      return 1
    fi
    sleep 2
  done
}

docker compose -f "$GDC_TEST_COMPOSE_FILE" up -d \
  postgres-test postgres-ontology-test webhook-receiver-test syslog-test

# When platform --profile lab WireMock is already on gdc-dev-validation, starting
# gdc-platform-test wiremock-test (container_name gdc-wiremock-test) causes DNS split-brain.
# Pytest host access still uses WIREMOCK_BASE_URL (default :28080) when the fixture is started.
if _platform_lab_wiremock_running 2>/dev/null; then
  echo "WARN: platform lab WireMock is running — skipping fixture wiremock-test to avoid DNS collision."
  echo "      Lab/runtime hostname: ${GDC_PLATFORM_WIREMOCK_BASE_URL:-http://gdc-platform-wiremock-test:8080}"
  echo "      Do not docker start exited gdc-platform-test WireMock while lab uses platform WireMock."
else
  docker compose -f "$GDC_TEST_COMPOSE_FILE" up -d wiremock-test
fi
_warn_duplicate_wiremock_containers 2>/dev/null || true

echo "Waiting for PostgreSQL test services..."
wait_compose_healthy "$PG_TEST_CONTAINER"
wait_compose_healthy "$ONTOLOGY_CONTAINER"

echo "Verifying pytest catalog connectivity (55440 ontology, 55441 smoke)..."
ONTOLOGY_TEST_DATABASE_URL="${ONTOLOGY_TEST_DATABASE_URL:-postgresql://gdc_ontology:gdc_ontology_pw@127.0.0.1:55440/gdc_ontology_test}" \
TEST_DATABASE_URL="${TEST_DATABASE_URL}" \
python3 - <<'PY'
import os
import sys
from sqlalchemy import create_engine, text

checks = [
    ("ontology", os.environ.get("ONTOLOGY_TEST_DATABASE_URL", ""), "gdc_ontology_test"),
    ("smoke", os.environ.get("TEST_DATABASE_URL", ""), "gdc_pytest"),
]
for label, url, expected_db in checks:
    if not url:
        print(f"ERROR: missing URL for {label} catalog", file=sys.stderr)
        sys.exit(1)
    engine = create_engine(url, pool_pre_ping=True)
    try:
        with engine.connect() as conn:
            db_name = conn.execute(text("select current_database()")).scalar_one()
            if db_name != expected_db:
                raise SystemExit(f"{label}: connected to unexpected database {db_name!r}")
    finally:
        engine.dispose()
    print(f"  {label} catalog ({expected_db}): OK")
PY

echo "Test stack up."
echo "  TEST_DATABASE_URL=$TEST_DATABASE_URL"
echo "  ONTOLOGY_TEST_DATABASE_URL=$ONTOLOGY_TEST_DATABASE_URL"
echo "  WIREMOCK_BASE_URL=$WIREMOCK_BASE_URL"
echo "  Webhook echo (optional): http://127.0.0.1:18091"
echo "  Syslog container (optional): 127.0.0.1:15514 tcp/udp"
