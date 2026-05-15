#!/usr/bin/env bash
# Bring up the full development E2E validation lab fixtures (PostgreSQL, WireMock,
# webhook receiver, syslog UDP/TCP/TLS sink, MinIO, fixture PostgreSQL, SFTP) and
# apply the platform schema. Wraps the existing isolated test stack defined in
# docker-compose.test.yml. Reads:
#   .specify/memory/constitution.md
#   .specify/specs-index.md
#   specs/001-core-architecture/spec.md
#   specs/002-runtime-pipeline/spec.md
#   specs/004-delivery-routing/spec.md
#   specs/031-source-expansion-test-environment/spec.md
#   specs/032-dev-validation-lab-source-expansion/spec.md
#   specs/036-source-adapter-e2e/spec.md
#   specs/037-visible-dev-e2e-fixtures/spec.md
#   docs/testing/source-adapter-e2e.md
#   docs/operator-runbook.md
#
# Safety:
#   - Loopback PostgreSQL only (127.0.0.1:55432).
#   - DB name must be gdc_test or gdc_e2e_test (test-only).
#   - Never targets the production stack (docker-compose.platform.yml).
#   - Idempotent: re-running this script reuses healthy containers and re-seeds
#     fixtures without overwriting user-created entities in gdc_test.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$ROOT/.dev-validation-logs"
COMPOSE_FILE="$ROOT/docker-compose.test.yml"
COMPOSE_PROJECT="${GDC_FULL_E2E_COMPOSE_PROJECT:-gdc-platform-test}"
PROFILE="${GDC_FULL_E2E_COMPOSE_PROFILE:-test}"

TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://gdc:gdc@127.0.0.1:55432/gdc_test}"
export TEST_DATABASE_URL
export DATABASE_URL="${DATABASE_URL:-$TEST_DATABASE_URL}"
export WIREMOCK_BASE_URL="${WIREMOCK_BASE_URL:-http://127.0.0.1:28080}"
export SOURCE_E2E_MINIO_ENDPOINT="${SOURCE_E2E_MINIO_ENDPOINT:-http://127.0.0.1:59000}"
export SOURCE_E2E_MINIO_BUCKET="${SOURCE_E2E_MINIO_BUCKET:-gdc-source-e2e}"
export SOURCE_E2E_PG_FIXTURE_URL="${SOURCE_E2E_PG_FIXTURE_URL:-postgresql://gdc_fixture:gdc_fixture_pw@127.0.0.1:55433/gdc_query_fixture}"
export SOURCE_E2E_SFTP_HOST="${SOURCE_E2E_SFTP_HOST:-127.0.0.1}"
export SOURCE_E2E_SFTP_PORT="${SOURCE_E2E_SFTP_PORT:-22222}"

usage() {
  cat <<EOF
Usage: $0 [--no-seed] [--no-migrate] [--with-perf-seed] [--seed-visible-fixtures]

Brings up the full E2E lab:
  - PostgreSQL platform catalog (gdc_test on 127.0.0.1:55432)
  - WireMock (28080) + webhook echo (18091) + syslog sink (15514 tcp+udp)
  - MinIO (59000), fixture PostgreSQL (55433), SFTP (22222)

Options:
  --no-seed         Skip seeding MinIO/fixture PG/SFTP fixtures.
  --no-migrate      Skip 'alembic upgrade head' on the platform DB.
  --with-perf-seed  Seed bulk delivery_logs rows for the performance smoke
                    script. Default rows: 10000. Override with PERF_SEED_ROWS.
  --seed-visible-fixtures
                    After the stack is healthy, run
                    scripts/dev-validation/seed-visible-e2e-fixtures.sh against
                    TEST_DATABASE_URL (UI-visible [DEV E2E] entities). Default: off.

Environment overrides:
  TEST_DATABASE_URL              gdc_test / gdc_e2e_test on 127.0.0.1:55432
  GDC_FULL_E2E_COMPOSE_PROJECT   default: gdc-platform-test
  GDC_FULL_E2E_COMPOSE_PROFILE   default: test
EOF
}

DO_SEED=true
DO_MIGRATE=true
DO_PERF_SEED=false
DO_VISIBLE_UI_SEED=false
for arg in "$@"; do
  case "$arg" in
  --no-seed) DO_SEED=false ;;
  --no-migrate) DO_MIGRATE=false ;;
  --with-perf-seed) DO_PERF_SEED=true ;;
  --seed-visible-fixtures) DO_VISIBLE_UI_SEED=true ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    echo "Unknown option: $arg (try --help)" >&2
    exit 1
    ;;
  esac
done

mkdir -p "$LOG_DIR"

# --- Safety gate (multi-layer; matches start-dev-validation-lab.sh and
# tests/conftest.py allow-list) ---
python3 - <<'PY' || { echo "" >&2; echo "  Aborting full E2E lab start." >&2; exit 1; }
import os
import sys
from urllib.parse import urlparse

db_url = os.environ.get("DATABASE_URL", "")
app_env = (os.environ.get("APP_ENV", "") or "").strip().lower()

u = urlparse(db_url)
host = (u.hostname or "").lower()
port = u.port
user = u.username or ""
db_name = (u.path or "").lstrip("/").split("/")[0]

allowed_db_names = {"gdc_test", "gdc_e2e_test"}
errors: list[str] = []
if u.scheme not in ("postgresql", "postgres"):
    errors.append(f"DATABASE_URL must be postgresql:// (got scheme={u.scheme!r})")
if db_name not in allowed_db_names:
    errors.append(
        f"DATABASE_URL database must be one of {sorted(allowed_db_names)} (got {db_name!r})"
    )
if port != 55432:
    errors.append(f"DATABASE_URL port must be 55432 (got {port!r})")
if user != "gdc":
    errors.append(f"DATABASE_URL user must be 'gdc' (got {user!r})")
if host not in ("127.0.0.1", "localhost", "::1"):
    errors.append(f"DATABASE_URL host must be loopback (got {host!r})")
if app_env in {"production", "prod"}:
    errors.append(f"APP_ENV must not be production/prod (got {app_env!r})")

if errors:
    print("", file=sys.stderr)
    print("ERROR: Full E2E dev validation lab safety gate refused to start.", file=sys.stderr)
    for e in errors:
        print(f"  - {e}", file=sys.stderr)
    print("", file=sys.stderr)
    print("  This lab is dev/test-only. It refuses to target anything except", file=sys.stderr)
    print("  the isolated test profile (loopback 55432, user gdc, db gdc_test/gdc_e2e_test).", file=sys.stderr)
    sys.exit(1)
print(f"  Safety gate OK (DATABASE_URL={db_name}@{host}:{port} user={user}, APP_ENV={app_env or 'unset'}).")
PY

echo ""
echo "================================================================"
echo " Starting full E2E lab (compose project: $COMPOSE_PROJECT, profile: $PROFILE)"
echo "================================================================"

docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --profile "$PROFILE" up -d \
  postgres-test \
  wiremock-test \
  webhook-receiver-test \
  syslog-test \
  minio-test \
  postgres-query-test \
  sftp-test

# --- Wait for platform catalog DB ---
echo "Waiting for postgres-test healthy …"
for _ in $(seq 1 90); do
  if docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --profile "$PROFILE" exec -T postgres-test \
    pg_isready -U gdc -d gdc_test >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# --- Wait for fixture DB ---
echo "Waiting for postgres-query-test healthy …"
for _ in $(seq 1 90); do
  if docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --profile "$PROFILE" exec -T postgres-query-test \
    pg_isready -U gdc_fixture -d gdc_query_fixture >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# --- Wait for WireMock ---
echo "Waiting for WireMock admin endpoint …"
for _ in $(seq 1 90); do
  if curl -sf "$WIREMOCK_BASE_URL/__admin/mappings" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# --- Wait for MinIO ---
echo "Waiting for MinIO API …"
for _ in $(seq 1 90); do
  if curl -sf "$SOURCE_E2E_MINIO_ENDPOINT/minio/health/ready" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# --- Wait for SFTP (TCP open) ---
echo "Waiting for sftp-test TCP …"
for _ in $(seq 1 60); do
  if python3 -c "import socket,sys; s=socket.socket(); s.settimeout(1.0); s.connect(('$SOURCE_E2E_SFTP_HOST', $SOURCE_E2E_SFTP_PORT)); s.close()" 2>/dev/null; then
    break
  fi
  sleep 1
done

# --- Wait for syslog-test (TCP open) ---
echo "Waiting for syslog-test TCP …"
for _ in $(seq 1 60); do
  if python3 -c "import socket,sys; s=socket.socket(); s.settimeout(1.0); s.connect(('127.0.0.1', 15514)); s.close()" 2>/dev/null; then
    break
  fi
  sleep 1
done

# --- Apply alembic migrations against the platform DB ---
if [[ "$DO_MIGRATE" == true ]]; then
  echo ""
  echo "Applying alembic migrations to $TEST_DATABASE_URL …"
  cd "$ROOT"
  ALOG="$LOG_DIR/alembic_full_e2e.log"
  set +e
  DATABASE_URL="$TEST_DATABASE_URL" python3 -m alembic upgrade head >"$ALOG" 2>&1
  ALEMBIC_EC=$?
  set -e
  if [[ "$ALEMBIC_EC" -ne 0 ]]; then
    echo "Alembic upgrade failed (exit $ALEMBIC_EC). Tail: $ALOG" >&2
    tail -n 40 "$ALOG" >&2 || true
    echo "Repair (test DB only): $ROOT/scripts/dev-validation/reset-dev-validation-db.sh" >&2
    exit 1
  fi
  echo "Migrations applied."
fi

# --- Seed source fixtures (MinIO + fixture PG + SFTP) ---
if [[ "$DO_SEED" == true ]]; then
  echo ""
  echo "Seeding source E2E fixtures …"
  bash "$ROOT/scripts/testing/source-e2e/seed-fixtures.sh"
fi

# --- Optional: pre-seed bulk delivery_logs rows for the perf smoke ---
if [[ "$DO_PERF_SEED" == true ]]; then
  ROWS="${PERF_SEED_ROWS:-10000}"
  echo ""
  echo "Pre-seeding ${ROWS} delivery_logs rows (perf smoke) …"
  cd "$ROOT"
  DATABASE_URL="$TEST_DATABASE_URL" python3 scripts/seed_delivery_logs_perf_data.py \
    --rows "$ROWS" --batch-size 1000 --days 14 --delete-existing
fi

if [[ "$DO_VISIBLE_UI_SEED" == true ]]; then
  echo ""
  echo "Seeding UI-visible [DEV E2E] catalog entities …"
  DATABASE_URL="$TEST_DATABASE_URL" bash "$ROOT/scripts/dev-validation/seed-visible-e2e-fixtures.sh"
fi

cat <<EOF

================================================================
 Full E2E dev validation lab is up
================================================================
  Platform DB:        $TEST_DATABASE_URL
  WireMock:           $WIREMOCK_BASE_URL
  Webhook echo:       http://127.0.0.1:18091
  Syslog UDP/TCP:     127.0.0.1:15514
  Syslog TLS:         127.0.0.1:16514  (self-signed dev cert; use insecure_skip_verify in lab)
  MinIO API:          $SOURCE_E2E_MINIO_ENDPOINT  (bucket=$SOURCE_E2E_MINIO_BUCKET)
  Fixture PostgreSQL: $SOURCE_E2E_PG_FIXTURE_URL
  SFTP:               $SOURCE_E2E_SFTP_HOST:$SOURCE_E2E_SFTP_PORT  (user=gdc / pw=devlab123)

Next steps:
  ./scripts/dev-validation/seed-visible-e2e-fixtures.sh   # optional: UI-visible [DEV E2E] rows (idempotent)
  ./scripts/dev-validation/run-full-e2e-validation.sh     # E2E matrix
  ./scripts/dev-validation/run-performance-smoke.sh       # perf smoke
  ./scripts/dev-validation/stop-full-e2e-lab.sh           # teardown

UI-visible fixtures (manual Run Once in the UI) are documented in:
  docs/testing/visible-dev-e2e-fixtures.md
EOF
