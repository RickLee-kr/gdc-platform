#!/usr/bin/env bash
# One-command Dev Validation Lab: Docker test stack + migrations + source E2E fixtures
# + idempotent [DEV E2E] UI catalog seed (unless SKIP_VISIBLE_E2E_SEED=1) + API + Vite.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$ROOT/.dev-validation-logs"
COMPOSE_FILE="$ROOT/docker-compose.dev-validation.yml"
# Without an explicit project name, compose can merge with the default `docker-compose.yml`
# project in this directory. Pin to the test stack project (see docker-compose.test.yml).
LAB_COMPOSE_PROJECT="${GDC_DEV_VALIDATION_COMPOSE_PROJECT:-gdc-platform-test}"
BACK_PID_FILE="$LOG_DIR/backend.pid"
FRONT_PID_FILE="$LOG_DIR/frontend.pid"
API_ROOT="${DEV_VALIDATION_API_ROOT:-http://127.0.0.1:8000}"
API_PREFIX="${DEV_VALIDATION_API_PREFIX:-/api/v1}"

kill_pidfile() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  local pid
  pid="$(tr -d ' \n\r\t' <"$f" | head -c 32)"
  [[ "$pid" =~ ^[0-9]+$ ]] || {
    rm -f "$f"
    return 0
  }
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 40); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$f"
}

cleanup() {
  echo ""
  echo "Stopping backend and frontend..."
  kill_pidfile "$BACK_PID_FILE"
  kill_pidfile "$FRONT_PID_FILE"
  echo "Lab processes stopped. Docker test stack is still running; use:"
  echo "  $ROOT/scripts/dev-validation/stop-dev-validation-lab.sh --with-docker"
}

trap cleanup INT TERM

mkdir -p "$LOG_DIR"
kill_pidfile "$BACK_PID_FILE"
kill_pidfile "$FRONT_PID_FILE"

echo "Starting Docker test stack (dev-validation profile, project: $LAB_COMPOSE_PROJECT)..."
docker compose -p "$LAB_COMPOSE_PROJECT" -f "$COMPOSE_FILE" --profile dev-validation up -d

echo "Waiting for PostgreSQL to accept connections..."
until docker compose -p "$LAB_COMPOSE_PROJECT" -f "$COMPOSE_FILE" --profile dev-validation exec -T postgres-test \
  pg_isready -U gdc -d datarelay >/dev/null 2>&1; do
  sleep 1
done

# Defaults aligned with start-full-e2e-lab.sh / visible_e2e_seed.py / seed-fixtures.sh
export WIREMOCK_BASE_URL="${WIREMOCK_BASE_URL:-http://127.0.0.1:28080}"
export SOURCE_E2E_MINIO_ENDPOINT="${SOURCE_E2E_MINIO_ENDPOINT:-http://127.0.0.1:59000}"
export SOURCE_E2E_MINIO_BUCKET="${SOURCE_E2E_MINIO_BUCKET:-gdc-source-e2e}"
export SOURCE_E2E_MINIO_ACCESS_KEY="${SOURCE_E2E_MINIO_ACCESS_KEY:-gdcminioaccess}"
export SOURCE_E2E_MINIO_SECRET_KEY="${SOURCE_E2E_MINIO_SECRET_KEY:-gdcminioaccesssecret12}"
export SOURCE_E2E_PG_FIXTURE_URL="${SOURCE_E2E_PG_FIXTURE_URL:-postgresql://gdc_fixture:gdc_fixture_pw@127.0.0.1:55433/gdc_query_fixture}"
export SOURCE_E2E_SFTP_HOST="${SOURCE_E2E_SFTP_HOST:-127.0.0.1}"
export SOURCE_E2E_SFTP_PORT="${SOURCE_E2E_SFTP_PORT:-22222}"

echo "Waiting for WireMock admin endpoint …"
for _ in $(seq 1 90); do
  if curl -sf "${WIREMOCK_BASE_URL}/__admin/mappings" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Waiting for MinIO API …"
for _ in $(seq 1 90); do
  if curl -sf "${SOURCE_E2E_MINIO_ENDPOINT}/minio/health/ready" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Waiting for postgres-query-test healthy …"
for _ in $(seq 1 90); do
  if docker compose -p "$LAB_COMPOSE_PROJECT" -f "$COMPOSE_FILE" --profile dev-validation exec -T postgres-query-test \
    pg_isready -U gdc_fixture -d gdc_query_fixture >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Waiting for sftp-test TCP …"
for _ in $(seq 1 60); do
  if python3 -c "import socket; s=socket.socket(); s.settimeout(1.0); s.connect(('$SOURCE_E2E_SFTP_HOST', $SOURCE_E2E_SFTP_PORT)); s.close()" 2>/dev/null; then
    break
  fi
  sleep 1
done

echo "Waiting for syslog-test TCP …"
for _ in $(seq 1 60); do
  if python3 -c "import socket; s=socket.socket(); s.settimeout(1.0); s.connect(('127.0.0.1', 15514)); s.close()" 2>/dev/null; then
    break
  fi
  sleep 1
done

export ENABLE_DEV_VALIDATION_LAB=true
export DEV_VALIDATION_AUTO_START=true
# Lab catalog URL (must match seeds, alembic, and uvicorn). Do not use
# ${DATABASE_URL:-...} here — a pre-exported DATABASE_URL from .env or the shell
# would otherwise diverge from TEST_DATABASE_URL and break the seed API check / UI.
export TEST_DATABASE_URL="postgresql://gdc:gdc@127.0.0.1:55432/datarelay"
export DATABASE_URL="$TEST_DATABASE_URL"
export WIREMOCK_BASE_URL="${WIREMOCK_BASE_URL:-http://127.0.0.1:28080}"
export DEV_VALIDATION_WIREMOCK_BASE_URL="${DEV_VALIDATION_WIREMOCK_BASE_URL:-http://127.0.0.1:28080}"
export DEV_VALIDATION_WEBHOOK_BASE_URL="${DEV_VALIDATION_WEBHOOK_BASE_URL:-http://127.0.0.1:18091}"
export DEV_VALIDATION_SYSLOG_HOST="${DEV_VALIDATION_SYSLOG_HOST:-127.0.0.1}"
export DEV_VALIDATION_SYSLOG_PORT="${DEV_VALIDATION_SYSLOG_PORT:-15514}"

# Optional lab slices (default on for this script: fixtures are started above; operators may export false to disable).
export ENABLE_DEV_VALIDATION_S3="${ENABLE_DEV_VALIDATION_S3:-true}"
export ENABLE_DEV_VALIDATION_DATABASE_QUERY="${ENABLE_DEV_VALIDATION_DATABASE_QUERY:-true}"
export ENABLE_DEV_VALIDATION_REMOTE_FILE="${ENABLE_DEV_VALIDATION_REMOTE_FILE:-true}"
export ENABLE_DEV_VALIDATION_PERFORMANCE="${ENABLE_DEV_VALIDATION_PERFORMANCE:-false}"
export MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://127.0.0.1:59000}"
export MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-gdcminioaccess}"
export MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-gdcminioaccesssecret12}"
export MINIO_BUCKET="${MINIO_BUCKET:-gdc-test-logs}"
export DEV_VALIDATION_PG_QUERY_HOST="${DEV_VALIDATION_PG_QUERY_HOST:-127.0.0.1}"
export DEV_VALIDATION_PG_QUERY_PORT="${DEV_VALIDATION_PG_QUERY_PORT:-55433}"
export DEV_VALIDATION_MYSQL_QUERY_HOST="${DEV_VALIDATION_MYSQL_QUERY_HOST:-127.0.0.1}"
export DEV_VALIDATION_MYSQL_QUERY_PORT="${DEV_VALIDATION_MYSQL_QUERY_PORT:-33306}"
export DEV_VALIDATION_MARIADB_QUERY_HOST="${DEV_VALIDATION_MARIADB_QUERY_HOST:-127.0.0.1}"
export DEV_VALIDATION_MARIADB_QUERY_PORT="${DEV_VALIDATION_MARIADB_QUERY_PORT:-33307}"
export DEV_VALIDATION_SFTP_HOST="${DEV_VALIDATION_SFTP_HOST:-127.0.0.1}"
export DEV_VALIDATION_SFTP_PORT="${DEV_VALIDATION_SFTP_PORT:-22222}"
export DEV_VALIDATION_SFTP_USER="${DEV_VALIDATION_SFTP_USER:-gdc}"
export DEV_VALIDATION_SFTP_PASSWORD="${DEV_VALIDATION_SFTP_PASSWORD:-devlab123}"
export DEV_VALIDATION_SSH_SCP_HOST="${DEV_VALIDATION_SSH_SCP_HOST:-127.0.0.1}"
export DEV_VALIDATION_SSH_SCP_PORT="${DEV_VALIDATION_SSH_SCP_PORT:-22223}"
export DEV_VALIDATION_SSH_SCP_USER="${DEV_VALIDATION_SSH_SCP_USER:-gdc2}"
export DEV_VALIDATION_SSH_SCP_PASSWORD="${DEV_VALIDATION_SSH_SCP_PASSWORD:-devlab456}"
# Vite uses origin only; request paths already include /api/v1 (see frontend/src/api.ts + gdcApiPrefix.ts).
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-http://127.0.0.1:8000}"

# Safety gate: production separation.
#
# The lab seeder inserts [DEV VALIDATION] connectors / streams / destinations /
# validations into whatever DB is configured. If DATABASE_URL is overridden to
# a production database, `ENABLE_DEV_VALIDATION_LAB=true` would inject lab data
# into prod (app/dev_validation_lab/seeder.py also gates on APP_ENV, but we
# refuse here too — multi-layered, fail-loud at the operator boundary).
#
# Refuse to proceed unless:
#   - DATABASE_URL points at db=datarelay, port=55432, user=gdc, host loopback.
#   - APP_ENV is not production / prod.
#
# This script always sets DATABASE_URL / TEST_DATABASE_URL to the lab URL above
# (never production by design).
python3 - <<'PY' || { echo "" >&2; echo "  Aborting Dev Validation Lab start." >&2; exit 1; }
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

errors: list[str] = []
if u.scheme not in ("postgresql", "postgres"):
    errors.append(f"DATABASE_URL must be postgresql:// (got scheme={u.scheme!r})")
if db_name != "datarelay":
    errors.append(f"DATABASE_URL database must be 'datarelay' (got {db_name!r})")
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
    print("ERROR: Dev Validation Lab safety gate refused to start.", file=sys.stderr)
    for e in errors:
        print(f"  - {e}", file=sys.stderr)
    print("", file=sys.stderr)
    print("  This lab is dev-only. It refuses to seed [DEV VALIDATION] data unless", file=sys.stderr)
    print("  DATABASE_URL points at the isolated test profile:", file=sys.stderr)
    print("    postgresql://gdc:gdc@127.0.0.1:55432/datarelay", file=sys.stderr)
    print("  and APP_ENV is not production/prod.", file=sys.stderr)
    sys.exit(1)
print(f"  Safety gate OK (DATABASE_URL={db_name}@{host}:{port} user={user}, APP_ENV={app_env or 'unset'}).")
PY

echo ""
echo "Applying migrations to dev validation test DB..."
cd "$ROOT"
ALOG="$LOG_DIR/alembic_upgrade.log"
mkdir -p "$LOG_DIR"
set +e
if command -v alembic >/dev/null 2>&1; then
  DATABASE_URL="$TEST_DATABASE_URL" alembic upgrade head >"$ALOG" 2>&1
  ALEMBIC_EC=$?
else
  DATABASE_URL="$TEST_DATABASE_URL" python3 -m alembic upgrade head >"$ALOG" 2>&1
  ALEMBIC_EC=$?
fi
set -euo pipefail
if [[ "$ALEMBIC_EC" -ne 0 ]]; then
  echo "Alembic upgrade failed (exit $ALEMBIC_EC). Full log: $ALOG" >&2
  if grep -qiE 'already exists|duplicatetable|relation .* already exists' "$ALOG" 2>/dev/null; then
    echo "" >&2
    echo "Likely cause: tables already exist in datarelay but Alembic history is missing or out of sync." >&2
  fi
  if grep -qiE 'alembic_version.*does not exist|undefinedtable.*alembic_version' "$ALOG" 2>/dev/null; then
    echo "" >&2
    echo "Likely cause: alembic_version table missing while other objects may exist." >&2
  fi
  echo "" >&2
  echo "Repair (explicit, datarelay only — does not run automatically):" >&2
  echo "  $ROOT/scripts/dev-validation/reset-dev-validation-db.sh" >&2
  echo "" >&2
  echo "---- alembic log (tail) ----" >&2
  tail -n 50 "$ALOG" >&2 || true
  exit 1
fi
echo "Migrations applied successfully."

# Platform UI login: ensure admin exists on datarelay (create-only). Fresh DB after
# reset-db has no platform_users; full `app.db.seed` would also add "Sample API Connector"
# which is redundant with the dev validation lab inventory.
LAB_DEFAULT_ADMIN_PASSWORD="${LAB_DEFAULT_ADMIN_PASSWORD:-Stellar1!}"
export GDC_SEED_ADMIN_PASSWORD="${GDC_SEED_ADMIN_PASSWORD:-$LAB_DEFAULT_ADMIN_PASSWORD}"
echo "Ensuring platform admin user exists (create-only; password from GDC_SEED_ADMIN_PASSWORD)..."
if ! DATABASE_URL="$TEST_DATABASE_URL" python3 -m app.db.seed --platform-admin-only; then
  echo "Platform admin seed failed." >&2
  exit 1
fi
echo "Lab UI login: username admin."
echo "  If admin was just created: password is the current GDC_SEED_ADMIN_PASSWORD (default Stellar1! unless you exported it before start)."
echo "  If admin already existed: password was not changed."

if [[ "${SKIP_VISIBLE_E2E_SEED:-}" == "1" ]]; then
  echo ""
  echo "SKIP_VISIBLE_E2E_SEED=1 — skipping scripts/testing/source-e2e/seed-fixtures.sh and [DEV E2E] catalog seed."
else
  echo ""
  echo "Seeding source E2E fixtures (MinIO / fixture PostgreSQL / SFTP) …"
  bash "$ROOT/scripts/testing/source-e2e/seed-fixtures.sh"
  echo "Seeding dev-validation lab fixtures (security_events, security/, lab-*.ndjson) …"
  bash "$ROOT/scripts/dev-validation/seed-lab-fixtures.sh"
  echo "Seeding UI-visible [DEV E2E] catalog rows (idempotent; PostgreSQL ORM only) …"
  if ! DATABASE_URL="$TEST_DATABASE_URL" bash "$ROOT/scripts/dev-validation/seed-visible-e2e-fixtures.sh"; then
    echo "Visible [DEV E2E] catalog seed failed." >&2
    exit 1
  fi
fi

echo "Starting backend (uvicorn)..."
(
  cd "$ROOT"
  exec uvicorn app.main:app --host 0.0.0.0 --port 8000
) >>"$LOG_DIR/backend.log" 2>&1 &
BACK_PID=$!
echo "$BACK_PID" >"$BACK_PID_FILE"

echo "Waiting for API process (/health)..."
for _ in $(seq 1 120); do
  if curl -fsS -o /dev/null --max-time 2 "$API_ROOT/health" 2>/dev/null; then
    break
  fi
  sleep 0.5
  if ! kill -0 "$BACK_PID" 2>/dev/null; then
    echo "Backend exited before becoming healthy. See: $LOG_DIR/backend.log" >&2
    exit 1
  fi
done

python3 - <<'PY' >>"$LOG_DIR/backend.log"
import json
import os

from sqlalchemy.engine import make_url

raw = (os.environ.get("DATABASE_URL") or "").strip()
try:
    masked = make_url(raw).render_as_string(hide_password=True) if raw else "<unset>"
except Exception:
    masked = "<unparseable>"
print(
    json.dumps(
        {
            "stage": "dev_validation_lab_effective_database_url",
            "database_url_masked": masked,
            "database_url_source": "environment",
        }
    )
)
PY

echo "Verifying dev validation lab data via API..."
# curl hits this uvicorn process; DATABASE_URL is forced to datarelay above so this matches
# the same DB used for visible E2E seed (not a separate direct-psql probe).
# When REQUIRE_AUTH=true (e.g. from .env), list endpoints return 401 without a Bearer token.
LAB_CURL_AUTH=()
LAB_LOGIN_PASSWORD="${GDC_SEED_ADMIN_PASSWORD:-Stellar1!}"
export LAB_LOGIN_PASSWORD
__login_body="$(python3 -c 'import json, os; print(json.dumps({"username": "admin", "password": os.environ["LAB_LOGIN_PASSWORD"]}))')"
unset LAB_LOGIN_PASSWORD
LAB_API_TOKEN=""
for _ in $(seq 1 30); do
  if LAB_OUT="$(curl -fsS --max-time 4 -X POST "$API_ROOT${API_PREFIX}/auth/login" \
    -H 'Content-Type: application/json' \
    -d "$__login_body" 2>/dev/null)"; then
    if LAB_API_TOKEN="$(printf '%s\n' "$LAB_OUT" | python3 -c 'import json, sys; print(json.load(sys.stdin)["access_token"])' 2>/dev/null)"; then
      if [[ -n "$LAB_API_TOKEN" ]]; then
        LAB_CURL_AUTH=(-H "Authorization: Bearer $LAB_API_TOKEN")
        break
      fi
    fi
  fi
  sleep 0.5
done
if [[ "${#LAB_CURL_AUTH[@]}" -eq 0 ]]; then
  echo "WARN: admin JWT not obtained for seed API check; using unauthenticated curl (works when REQUIRE_AUTH=false)." >&2
fi

SEED_OK=0
CONN_BODY=""
VAL_BODY=""
for _ in $(seq 1 90); do
  CONN_BODY=$(curl -fsSL --max-time 4 "${LAB_CURL_AUTH[@]}" "$API_ROOT${API_PREFIX}/connectors/" 2>/dev/null || true)
  VAL_BODY=$(curl -fsSL --max-time 4 "${LAB_CURL_AUTH[@]}" "$API_ROOT${API_PREFIX}/validation/" 2>/dev/null || true)
  LAB_CONN=0
  LAB_VAL=0
  E2E_OK=0
  if echo "$CONN_BODY" | grep -qF '[DEV VALIDATION]'; then LAB_CONN=1; fi
  if echo "$VAL_BODY" | grep -qF 'dev_lab'; then LAB_VAL=1; fi
  if [[ "${SKIP_VISIBLE_E2E_SEED:-}" == "1" ]]; then
    E2E_OK=1
  elif echo "$CONN_BODY" | grep -qF '[DEV E2E]'; then
    E2E_OK=1
  fi
  if [[ "$LAB_CONN" -eq 1 && "$LAB_VAL" -eq 1 && "$E2E_OK" -eq 1 ]]; then
    SEED_OK=1
    break
  fi
  sleep 0.5
done

if [[ "$SEED_OK" -ne 1 ]]; then
  echo ""
  echo "================================================================"
  echo "  DEV VALIDATION LAB: seed API check did NOT find expected data"
  echo "================================================================"
  echo "  Backend log: $LOG_DIR/backend.log"
  echo ""
  echo "  Likely causes:"
  echo "    - ENABLE_DEV_VALIDATION_LAB / APP_ENV (see dev_validation_lab_config_snapshot in log)"
  echo "    - Database schema still not ready (scheduler / seeder skipped)"
  echo "    - Seeder exception (stage dev_validation_lab_seed_failed)"
  echo "    - Wrong DATABASE_URL vs TEST_DATABASE_URL"
  echo "    - REQUIRE_AUTH=true but admin login failed (check GDC_SEED_ADMIN_PASSWORD vs admin user)"
  echo "    - Visible E2E seed failed before backend start (scroll up for python errors)"
  echo ""
  echo "  Inspect backend log:"
  echo "    tail -n 120 \"$LOG_DIR/backend.log\""
  echo "    grep -E 'dev_validation_lab|startup_database' \"$LOG_DIR/backend.log\" | tail -n 80"
  echo "================================================================"
  echo ""
fi

echo "Starting frontend (Vite, VITE_API_BASE_URL=$VITE_API_BASE_URL)..."
(
  cd "$ROOT/frontend"
  exec npm run dev
) >>"$LOG_DIR/frontend.log" 2>&1 &
FRONT_PID=$!
echo "$FRONT_PID" >"$FRONT_PID_FILE"

echo ""
echo "================================================================"
echo " Dev Validation Lab is running"
echo "================================================================"
echo "  Backend:  http://127.0.0.1:8000/docs"
echo "  Frontend: http://127.0.0.1:5173"
echo ""
echo "  Frontend API origin (Vite): $VITE_API_BASE_URL"
echo "  (JSON requests use paths under ${VITE_API_BASE_URL}${API_PREFIX}/…)"
echo ""
echo "  Logs: $LOG_DIR/backend.log"
echo "        $LOG_DIR/frontend.log"
echo "================================================================"
echo ""
if [[ "$SEED_OK" -eq 1 ]]; then
  echo "Lab seed API check: OK (connectors + validation definitions visible)."
else
  echo "Lab seed API check: FAILED — fix backend, then reload the UI (see messages above)."
fi
echo ""
echo "Press Ctrl+C to stop backend and frontend (Docker keeps running)."
echo ""

wait "$BACK_PID" "$FRONT_PID" || true
rm -f "$BACK_PID_FILE" "$FRONT_PID_FILE"
trap - INT TERM
