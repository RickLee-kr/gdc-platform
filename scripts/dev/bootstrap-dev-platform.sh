#!/usr/bin/env bash
# Single-source-of-truth developer validation bootstrap (idempotent; preserves volumes and admin password).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/.env"
PLATFORM_COMPOSE_FILE="$ROOT/docker-compose.platform.yml"
PLATFORM_OVERLAY="$ROOT/docker-compose.platform.dev-validation.yml"
PLATFORM_COMPOSE=(docker compose -f "$PLATFORM_COMPOSE_FILE" -f "$PLATFORM_OVERLAY")
DEV_VALIDATION_NET="${GDC_DEV_VALIDATION_DOCKER_NETWORK:-gdc-dev-validation}"
PLATFORM_PG_PORT="${GDC_PLATFORM_POSTGRES_HOST_PORT:-55432}"
PLATFORM_DATABASE_URL="postgresql://gdc:gdc@127.0.0.1:${PLATFORM_PG_PORT}/gdc"

# shellcheck source=scripts/dev/lib/normalize-dev-env.sh
source "$ROOT/scripts/dev/lib/normalize-dev-env.sh"
# shellcheck source=scripts/dev-validation/lib/fixture-compose.sh
source "$ROOT/scripts/dev-validation/lib/fixture-compose.sh"
# shellcheck source=scripts/dev-validation/lib/db-exec.sh
source "$ROOT/scripts/dev-validation/lib/db-exec.sh"

usage() {
  cat <<'EOF'
Usage: ./scripts/dev/bootstrap-dev-platform.sh [options]

Starts the full developer validation environment:
  - platform PostgreSQL (127.0.0.1:55432/gdc) — volumes preserved
  - API, frontend, reverse proxy
  - dev-validation fixture services (S3, query DBs, SFTP, WireMock on shared network)
  - pytest catalogs (127.0.0.1:55440 ontology, 127.0.0.1:55441 smoke)
  - Alembic upgrade head, idempotent [DEV VALIDATION] / [DEV E2E] seeds, fixture data
  - readiness validation

Does not delete Docker volumes, truncate platform data, or reset admin passwords.

Options:
  --skip-validate   Start stacks and seeds only; do not run validate-platform-ready.sh
  -h, --help        Show this help

Contract: docs/dev/dev-platform-environment-contract.md
EOF
}

SKIP_VALIDATE=false
for arg in "$@"; do
  case "$arg" in
    --skip-validate) SKIP_VALIDATE=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $arg (use --help)" >&2; exit 1 ;;
  esac
done

case "${APP_ENV:-development}" in
  production|prod)
    echo "ERROR: refusing bootstrap with APP_ENV=${APP_ENV:-}" >&2
    exit 1
    ;;
esac

echo "=== GDC developer platform bootstrap ==="
echo "Admin contract: username admin; password admin unless GDC_SEED_ADMIN_PASSWORD is set."
echo "Persisted admin passwords are never overwritten automatically."
echo "To reset a known admin password without touching platform data:"
echo "  GDC_SEED_ADMIN_PASSWORD='<new>' ./scripts/admin/reset-admin-password.sh"
echo ""

normalize_dev_env_file "$ENV_FILE"

FIXTURE_SERVICES=(
  # Skip gdc-platform-test wiremock-test when platform lab WireMock is the lab HTTP source of truth.
  webhook-receiver-test
  syslog-test
  minio-test
  postgres-query-test
  mysql-query-test
  mariadb-query-test
  sftp-test
  ssh-scp-test
)

echo "[1/8] Ensuring dev-validation Docker network ($DEV_VALIDATION_NET)..."
if ! docker network inspect "$DEV_VALIDATION_NET" >/dev/null 2>&1; then
  docker network create "$DEV_VALIDATION_NET" >/dev/null
fi

echo "[2/8] Starting dev-validation fixture services..."
echo "  WireMock: platform lab only (${GDC_PLATFORM_WIREMOCK_BASE_URL}); do not start duplicate gdc-platform-test WireMock."
mapfile -t FIXTURE_SERVICES_FILTERED < <(_filter_fixture_services_skip_wiremock_if_needed yes "${FIXTURE_SERVICES[@]}")
_fixture_compose up -d "${FIXTURE_SERVICES_FILTERED[@]}"
_warn_duplicate_wiremock_containers

if _fixture_service_running postgres-query-test; then
  echo "  waiting for postgres-query-test..."
  _wait_sql_tcp postgres-query-test gdc_fixture gdc_fixture_pw gdc_query_fixture
fi
if _fixture_service_running mysql-query-test; then
  echo "  waiting for mysql-query-test..."
  _wait_sql_tcp mysql-query-test gdc_fixture gdc_fixture_pw gdc_query_fixture
fi
if _fixture_service_running mariadb-query-test; then
  echo "  waiting for mariadb-query-test..."
  _wait_sql_tcp mariadb-query-test gdc_fixture gdc_fixture_pw gdc_query_fixture
fi
for _ in $(seq 1 90); do
  if docker run --rm --network "$DEV_VALIDATION_DOCKER_NETWORK" curlimages/curl:8.7.1 \
    -sf "http://gdc-minio-test:9000/minio/health/ready" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[3/8] Seeding external fixture data (MinIO, query DBs, remote files)..."
bash "$ROOT/scripts/dev-validation/seed-lab-fixtures.sh"

echo "[4/8] Building and starting platform stack (postgres, api, scheduler, frontend, reverse proxy + lab fixtures)..."
"${PLATFORM_COMPOSE[@]}" build
# Lab profile starts platform WireMock / webhook / syslog; ENABLE_DEV_VALIDATION_LAB=true comes from overlay.
# Reuse healthy platform WireMock; never auto-start exited gdc-platform-test wiremock-test.
if _platform_lab_wiremock_running; then
  echo "  platform WireMock already running — reusing ${GDC_PLATFORM_WIREMOCK_BASE_URL}"
  "${PLATFORM_COMPOSE[@]}" --profile lab up -d postgres api scheduler frontend reverse-proxy gdc-webhook-receiver-test gdc-syslog-test
else
  "${PLATFORM_COMPOSE[@]}" --profile lab up -d postgres api scheduler frontend reverse-proxy gdc-wiremock-test gdc-webhook-receiver-test gdc-syslog-test
fi
_warn_duplicate_wiremock_containers

echo "[5/8] Starting pytest PostgreSQL stacks (55440 ontology, 55441 smoke)..."
bash "$ROOT/scripts/testing/start-test-stack.sh"

echo "[6/8] Waiting for platform API health..."
for _ in $(seq 1 120); do
  if docker exec gdc-platform-api wget -qO- http://127.0.0.1:8000/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker exec gdc-platform-api wget -qO- http://127.0.0.1:8000/health >/dev/null \
  || { echo "ERROR: gdc-platform-api did not become healthy" >&2; exit 1; }

if ! docker network inspect "$DEV_VALIDATION_NET" --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null \
  | grep -qF 'gdc-platform-api'; then
  echo "  attaching gdc-platform-api to $DEV_VALIDATION_NET..."
  docker network connect "$DEV_VALIDATION_NET" gdc-platform-api 2>/dev/null || true
  if ! docker network inspect "$DEV_VALIDATION_NET" --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null \
    | grep -qF 'gdc-platform-api'; then
    echo "ERROR: failed to attach gdc-platform-api to $DEV_VALIDATION_NET (S3/DB/SFTP E2E streams will not poll)" >&2
    exit 1
  fi
fi

echo "[7/8] Applying Alembic migrations and idempotent dev seeds..."
"${PLATFORM_COMPOSE[@]}" exec -T api alembic upgrade head

dev_e2e_count="$(
  docker exec gdc-platform-postgres psql -U gdc -d gdc -t -A \
    -c "SELECT COUNT(*) FROM streams WHERE name LIKE '[DEV E2E] %';" 2>/dev/null | tr -d '[:space:]' || echo 0
)"
if [[ "${dev_e2e_count:-0}" -lt 5 ]]; then
  echo "  seeding UI-visible [DEV E2E] fixtures on platform catalog..."
  export DATABASE_URL="$PLATFORM_DATABASE_URL"
  export WIREMOCK_BASE_URL="${WIREMOCK_BASE_URL:-http://127.0.0.1:28080}"
  export GDC_VISIBLE_E2E_WEBHOOK_BASE_URL="${GDC_VISIBLE_E2E_WEBHOOK_BASE_URL:-http://127.0.0.1:18091}"
  export GDC_VISIBLE_E2E_SYSLOG_HOST="${GDC_VISIBLE_E2E_SYSLOG_HOST:-127.0.0.1}"
  export GDC_VISIBLE_E2E_SYSLOG_PLAIN_PORT="${GDC_VISIBLE_E2E_SYSLOG_PLAIN_PORT:-15514}"
  export GDC_VISIBLE_E2E_SYSLOG_TLS_PORT="${GDC_VISIBLE_E2E_SYSLOG_TLS_PORT:-16514}"
  export SOURCE_E2E_MINIO_ENDPOINT="${SOURCE_E2E_MINIO_ENDPOINT:-http://127.0.0.1:59000}"
  export SOURCE_E2E_MINIO_BUCKET="${SOURCE_E2E_MINIO_BUCKET:-gdc-source-e2e}"
  export SOURCE_E2E_PG_FIXTURE_HOST="${SOURCE_E2E_PG_FIXTURE_HOST:-127.0.0.1}"
  export SOURCE_E2E_PG_FIXTURE_PORT="${SOURCE_E2E_PG_FIXTURE_PORT:-55433}"
  export SOURCE_E2E_SFTP_HOST="${SOURCE_E2E_SFTP_HOST:-127.0.0.1}"
  export SOURCE_E2E_SFTP_PORT="${SOURCE_E2E_SFTP_PORT:-22222}"
  bash "$ROOT/scripts/dev-validation/seed-visible-e2e-fixtures.sh" --local-dev-mode
fi

echo "  removing leaked pytest catalog rows (e2e-connector orphans)..."
bash "$ROOT/scripts/dev-validation/cleanup-pytest-catalog-leaks.sh"

dev_val_count="$(
  docker exec gdc-platform-postgres psql -U gdc -d gdc -t -A \
    -c "SELECT COUNT(*) FROM streams WHERE name LIKE '[DEV VALIDATION] %';" 2>/dev/null | tr -d '[:space:]' || echo 0
)"
if [[ "${dev_val_count:-0}" -lt 1 ]]; then
  echo "  restarting API to run [DEV VALIDATION] lab seed (fixtures now available)..."
  "${PLATFORM_COMPOSE[@]}" restart api
  for _ in $(seq 1 90); do
    if docker exec gdc-platform-api wget -qO- http://127.0.0.1:8000/health >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
fi

echo "[8/8] Readiness validation..."
if [[ "$SKIP_VALIDATE" == "true" ]]; then
  echo "Skipped (--skip-validate). Run: ./scripts/dev/validate-platform-ready.sh"
else
  "$ROOT/scripts/dev/validate-platform-ready.sh"
fi

echo ""
echo "Developer platform bootstrap complete."
echo "  Platform DB: 127.0.0.1:${PLATFORM_PG_PORT}/gdc"
echo "  Ontology pytest DB: 127.0.0.1:55440/gdc_ontology_test"
echo "  Smoke pytest DB: 127.0.0.1:55441/gdc_pytest"
echo "  Contract: docs/dev/dev-platform-environment-contract.md"

# Playwright smoke credential guidance (no admin password is overwritten here).
# The auth contract forbids automatic resets, so this section only emits the
# explicit env vars the operator needs to export.
echo ""
echo "=== Playwright smoke credentials ==="
if [[ -n "${GDC_SEED_ADMIN_PASSWORD:-}" ]]; then
  echo "Playwright smoke credentials ready (using GDC_SEED_ADMIN_PASSWORD)."
  echo "  export PLAYWRIGHT_E2E_USERNAME=admin"
  echo "  export PLAYWRIGHT_E2E_PASSWORD=\"\$GDC_SEED_ADMIN_PASSWORD\""
else
  echo "Playwright smoke credentials: bootstrap defaults (admin/admin)."
  echo "  - First-install admin password is 'admin' with must_change_password=true."
  echo "  - Export PLAYWRIGHT_E2E_PASSWORD to a steady password BEFORE running smoke;"
  echo "    the smoke spec will perform the bootstrap password change automatically."
  echo "  Example:"
  echo "    export PLAYWRIGHT_E2E_USERNAME=admin"
  echo "    export PLAYWRIGHT_E2E_PASSWORD='GdcSmokeE2e!2026'"
  echo "    export PLAYWRIGHT_E2E_ALLOW_BOOTSTRAP_FALLBACK=true"
fi
echo "Verify the environment without running browsers:"
echo "  cd frontend && npm run validate:playwright-smoke"
echo "Run the smoke suite:"
echo "  cd frontend && npm run test:playwright-smoke"
echo "Recovery if the admin password has drifted (no data loss):"
echo "  ./scripts/admin/reset-admin-password.sh --username admin --password '<new>'"
