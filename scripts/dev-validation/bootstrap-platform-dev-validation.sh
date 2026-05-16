#!/usr/bin/env bash
# Start isolated dev-validation fixtures and seed data for the development platform API.
# Safe for local use only — does not reset platform Postgres volumes.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.dev-validation.yml"
PROJECT="${GDC_DEV_VALIDATION_COMPOSE_PROJECT:-gdc-platform-test}"

if [[ "${APP_ENV:-development}" == "production" || "${APP_ENV:-}" == "prod" ]]; then
  echo "Refusing bootstrap: APP_ENV must not be production/prod." >&2
  exit 1
fi

# Platform catalog uses gdc-platform-postgres (host 55432). Fixture stack must not
# publish postgres-test on the same port — API reaches fixtures via gdc-test-fixtures network.
FIXTURE_SERVICES=(
  wiremock-test
  webhook-receiver-test
  syslog-test
  minio-test
  postgres-query-test
  mysql-query-test
  mariadb-query-test
  sftp-test
  ssh-scp-test
)

echo "Starting dev-validation fixture stack (project: $PROJECT, no postgres-test) …"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --profile dev-validation up -d "${FIXTURE_SERVICES[@]}"

echo "Waiting for postgres-query-test …"
for _ in $(seq 1 90); do
  if docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --profile dev-validation exec -T postgres-query-test \
    pg_isready -U gdc_fixture -d gdc_query_fixture >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Waiting for MinIO …"
for _ in $(seq 1 90); do
  if curl -sf "http://127.0.0.1:59000/minio/health/ready" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

bash "$ROOT/scripts/dev-validation/seed-lab-fixtures.sh"

PLATFORM_COMPOSE="-f $ROOT/docker-compose.platform.yml -f $ROOT/docker-compose.platform.dev-validation.yml"
echo ""
echo "Fixture stack is up and seeded. Start or restart the development platform API, for example:"
echo "  docker compose $PLATFORM_COMPOSE up -d --build api"
echo "  docker compose $PLATFORM_COMPOSE run --rm api alembic upgrade head"
echo ""
echo "With ENABLE_DEV_VALIDATION_LAB=true and APP_ENV=development, the API seeds HTTP, S3,"
echo "DATABASE_QUERY, and REMOTE_FILE_POLLING [DEV VALIDATION] streams on startup."
