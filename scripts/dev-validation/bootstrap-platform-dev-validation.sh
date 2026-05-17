#!/usr/bin/env bash
# Start isolated dev-validation fixtures and seed data for the development platform API.
# Safe for local use only — does not reset platform Postgres volumes.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/dev-validation/lib/fixture-compose.sh
source "$ROOT/scripts/dev-validation/lib/fixture-compose.sh"
# shellcheck source=scripts/dev-validation/lib/db-exec.sh
source "$ROOT/scripts/dev-validation/lib/db-exec.sh"

if [[ "${APP_ENV:-development}" == "production" || "${APP_ENV:-}" == "prod" ]]; then
  echo "Refusing bootstrap: APP_ENV must not be production/prod." >&2
  exit 1
fi

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

echo "Starting dev-validation fixture stack (project: $DEV_VALIDATION_COMPOSE_PROJECT, no postgres-test) …"
_fixture_compose up -d "${FIXTURE_SERVICES[@]}"

echo "Waiting for postgres-query-test …"
if _fixture_service_running postgres-query-test; then
  _wait_sql_tcp postgres-query-test gdc_fixture gdc_fixture_pw gdc_query_fixture
fi

echo "Waiting for mysql-query-test …"
if _fixture_service_running mysql-query-test; then
  _wait_sql_tcp mysql-query-test gdc_fixture gdc_fixture_pw gdc_query_fixture
fi

echo "Waiting for mariadb-query-test …"
if _fixture_service_running mariadb-query-test; then
  _wait_sql_tcp mariadb-query-test gdc_fixture gdc_fixture_pw gdc_query_fixture
fi

echo "Waiting for MinIO …"
for _ in $(seq 1 90); do
  if docker run --rm --network "$DEV_VALIDATION_DOCKER_NETWORK" curlimages/curl:8.7.1 \
    -sf "http://gdc-minio-test:9000/minio/health/ready" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

bash "$ROOT/scripts/dev-validation/seed-lab-fixtures.sh"
bash "$ROOT/scripts/dev-validation/smoke-fixture-bootstrap.sh"

PLATFORM_COMPOSE="-f $ROOT/docker-compose.platform.yml -f $ROOT/docker-compose.platform.dev-validation.yml"
echo ""
echo "Fixture stack is up and seeded. Start or restart the development platform API, for example:"
echo "  docker compose $PLATFORM_COMPOSE up -d --build api"
echo "  docker compose $PLATFORM_COMPOSE run --rm api alembic upgrade head"
echo ""
echo "With ENABLE_DEV_VALIDATION_LAB=true and APP_ENV=development, the API seeds HTTP, S3,"
echo "DATABASE_QUERY, and REMOTE_FILE_POLLING [DEV VALIDATION] streams on startup."
