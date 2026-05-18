#!/usr/bin/env bash
# Start the isolated PostgreSQL runtime for metric ontology / aggregate tests.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/.env.test.ontology"
COMPOSE_FILE="${GDC_TEST_COMPOSE_FILE:-$ROOT/docker-compose.test.yml}"
SERVICE="postgres-ontology-test"
export GDC_ONTOLOGY_TEST_CONTAINER_PREFIX="${GDC_ONTOLOGY_TEST_CONTAINER_PREFIX:-gdc}"
CONTAINER="${GDC_ONTOLOGY_TEST_CONTAINER_PREFIX}-postgres-ontology-test"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: missing ontology test env file: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

: "${DATABASE_URL:?DATABASE_URL is required in .env.test.ontology}"
: "${POSTGRES_USER:?POSTGRES_USER is required in .env.test.ontology}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required in .env.test.ontology}"
: "${POSTGRES_DB:?POSTGRES_DB is required in .env.test.ontology}"

if [[ "${TEST_METRIC_ONTOLOGY:-}" != "true" ]]; then
  echo "ERROR: TEST_METRIC_ONTOLOGY must be true in $ENV_FILE" >&2
  exit 1
fi

if [[ "$DATABASE_URL" != *"127.0.0.1:55440/$POSTGRES_DB" ]]; then
  echo "ERROR: DATABASE_URL must target the isolated ontology test DB on 127.0.0.1:55440/$POSTGRES_DB" >&2
  echo "       got: $DATABASE_URL" >&2
  exit 1
fi

cd "$ROOT"
export COMPOSE_PROFILES=ontology-test
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-$DATABASE_URL}"
export PGOPTIONS="${PGOPTIONS:-"-c lock_timeout=5000 -c statement_timeout=120000"}"

echo "Starting isolated ontology test PostgreSQL..."
docker compose -f "$COMPOSE_FILE" up -d "$SERVICE"

echo "Waiting for $CONTAINER health..."
deadline=$((SECONDS + 90))
while true; do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing-healthcheck{{end}}' "$CONTAINER" 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    break
  fi
  if (( SECONDS >= deadline )); then
    echo "ERROR: $CONTAINER did not become healthy (last status: ${status:-missing})." >&2
    docker compose -f "$COMPOSE_FILE" ps "$SERVICE" >&2 || true
    docker logs --tail 80 "$CONTAINER" >&2 || true
    exit 1
  fi
  sleep 2
done

echo "Verifying connectivity..."
python3 - <<'PY'
import os
from sqlalchemy import create_engine, text

url = os.environ["DATABASE_URL"]
engine = create_engine(url, pool_pre_ping=True)
try:
    with engine.connect() as conn:
        db_name = conn.execute(text("select current_database()")).scalar_one()
        user = conn.execute(text("select current_user")).scalar_one()
        if db_name != os.environ["POSTGRES_DB"]:
            raise SystemExit(f"connected to unexpected database {db_name!r}")
        if user != os.environ["POSTGRES_USER"]:
            raise SystemExit(f"connected as unexpected user {user!r}")
finally:
    engine.dispose()
PY

echo "Applying Alembic migrations..."
python3 -m alembic upgrade head

echo "Ontology test stack ready."
echo "  DATABASE_URL=$DATABASE_URL"
echo "  TEST_DATABASE_URL=$TEST_DATABASE_URL"
echo "  POSTGRES_DB=$POSTGRES_DB"
echo "  TEST_METRIC_ONTOLOGY=$TEST_METRIC_ONTOLOGY"
