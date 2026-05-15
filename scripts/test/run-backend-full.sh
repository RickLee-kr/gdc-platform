#!/usr/bin/env bash
# Deterministic full backend pytest: isolated gdc_test @ 127.0.0.1:55432 + compose fixtures.
# PostgreSQL only (no SQLite). Never targets production catalogs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

CANONICAL_TEST_DB_URL="postgresql://gdc:gdc@127.0.0.1:55432/gdc_test"
COMPOSE_FILE="${GDC_TEST_COMPOSE_FILE:-$ROOT/docker-compose.test.yml}"
export COMPOSE_PROFILES="${COMPOSE_PROFILES:-test}"

usage() {
  cat <<'USAGE'
Usage: ./scripts/test/run-backend-full.sh [options]

  1) Enforces TEST_DATABASE_URL and DATABASE_URL:
       postgresql://gdc:gdc@127.0.0.1:55432/gdc_test
  2) Starts or verifies dependencies via docker-compose.test.yml (when Docker is available)
  3) Optionally resets public schema on gdc_test (--fresh-schema; lab DB only)
  4) Runs: python3 -m alembic upgrade head
  5) Seeds source-adapter E2E fixtures (MinIO / fixture PG / SFTP)
  6) Runs: python3 -m pytest tests/ -q --tb=short

Options:
  --fresh-schema   DROP SCHEMA public CASCADE on gdc_test, then recreate public + grants.
                   Non-interactive (CI / scripts): set
                     GDC_BACKEND_FULL_TEST_RESET_CONFIRM=YES_I_RESET_GDC_TEST_ONLY
                   Interactive (local TTY, not CI): type RESET GDC TEST DB when prompted.

  -h, --help       Show this help.

Environment:
  WIREMOCK_BASE_URL   Default http://127.0.0.1:28080 (compose wiremock-test publish port)
  GDC_TEST_COMPOSE_FILE   Override compose file path (default: docker-compose.test.yml)

If Docker cannot bind 127.0.0.1:55432 (e.g. another process uses the port), start or free
the lab Postgres, then re-run.
USAGE
}

FRESH_SCHEMA=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --fresh-schema) FRESH_SCHEMA=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1 (try --help)" >&2
      exit 1
      ;;
  esac
  shift
done

# Enforced catalog URL (overrides caller environment for this process tree).
export TEST_DATABASE_URL="$CANONICAL_TEST_DB_URL"
export DATABASE_URL="$CANONICAL_TEST_DB_URL"
export WIREMOCK_BASE_URL="${WIREMOCK_BASE_URL:-http://127.0.0.1:28080}"

export SOURCE_E2E_MINIO_ENDPOINT="${SOURCE_E2E_MINIO_ENDPOINT:-http://127.0.0.1:59000}"
export SOURCE_E2E_MINIO_ACCESS_KEY="${SOURCE_E2E_MINIO_ACCESS_KEY:-gdcminioaccess}"
export SOURCE_E2E_MINIO_SECRET_KEY="${SOURCE_E2E_MINIO_SECRET_KEY:-gdcminioaccesssecret12}"
export SOURCE_E2E_MINIO_BUCKET="${SOURCE_E2E_MINIO_BUCKET:-gdc-source-e2e}"
export SOURCE_E2E_PG_FIXTURE_URL="${SOURCE_E2E_PG_FIXTURE_URL:-postgresql://gdc_fixture:gdc_fixture_pw@127.0.0.1:55433/gdc_query_fixture}"
export SOURCE_E2E_SFTP_HOST="${SOURCE_E2E_SFTP_HOST:-127.0.0.1}"
export SOURCE_E2E_SFTP_PORT="${SOURCE_E2E_SFTP_PORT:-22222}"

echo "==> Enforced TEST_DATABASE_URL / DATABASE_URL:"
echo "    $TEST_DATABASE_URL"

python3 - <<'PY' || exit 1
import os
import sys
from urllib.parse import urlparse

url = os.environ.get("TEST_DATABASE_URL", "")
u = urlparse(url)
if u.scheme not in ("postgresql", "postgres"):
    print("ERROR: URL must be postgresql.", file=sys.stderr)
    sys.exit(1)
host = (u.hostname or "").lower()
port = u.port
user = u.username or ""
password = u.password or ""
path = (u.path or "").strip("/")
db = path.split("/")[0] if path else ""

if db != "gdc_test":
    print(f"ERROR: database name must be exactly 'gdc_test' (got {db!r}).", file=sys.stderr)
    sys.exit(1)
if user != "gdc":
    print(f"ERROR: user must be 'gdc' (got {user!r}).", file=sys.stderr)
    sys.exit(1)
if password != "gdc":
    print(f"ERROR: password must match lab test user (refusing non-canonical URL).", file=sys.stderr)
    sys.exit(1)
if port != 55432:
    print(f"ERROR: port must be 55432 (got {port!r}).", file=sys.stderr)
    sys.exit(1)
if host != "127.0.0.1":
    print(f"ERROR: host must be 127.0.0.1 (got {host!r}).", file=sys.stderr)
    sys.exit(1)
print("  URL safety checks: OK (gdc_test @ 127.0.0.1:55432, user gdc).")
PY

wait_for_postgres() {
  echo "==> Waiting for PostgreSQL (gdc_test @ 127.0.0.1:55432) …"
  python3 - <<'PY' || return 1
import os
import sys
import time

try:
    import psycopg2
except ImportError:
    print("ERROR: psycopg2 is required (pip install -r requirements.txt).", file=sys.stderr)
    sys.exit(1)

url = os.environ["TEST_DATABASE_URL"]
deadline = time.monotonic() + 180.0
last_err = None
while time.monotonic() < deadline:
    try:
        conn = psycopg2.connect(url, connect_timeout=3)
        conn.close()
        print("  PostgreSQL is reachable.")
        sys.exit(0)
    except Exception as exc:
        last_err = str(exc).strip()
        time.sleep(1)

print("ERROR: could not connect to PostgreSQL before timeout.", file=sys.stderr)
if last_err:
    print(f"  Last error: {last_err}", file=sys.stderr)
sys.exit(1)
PY
}

if command -v docker >/dev/null 2>&1; then
  echo "==> docker compose up (postgres-test, WireMock, webhooks, syslog, MinIO, fixture PG, SFTP) …"
  docker compose -f "$COMPOSE_FILE" up -d \
    postgres-test wiremock-test webhook-receiver-test syslog-test \
    minio-test postgres-query-test sftp-test

  echo "==> Waiting for postgres-test container healthy (if present) …"
  for i in $(seq 1 90); do
    if docker compose -f "$COMPOSE_FILE" ps postgres-test 2>/dev/null | grep -qE "(healthy|running)"; then
      if docker compose -f "$COMPOSE_FILE" ps postgres-test 2>/dev/null | grep -q "healthy"; then
        break
      fi
    fi
    sleep 1
    if [[ "$i" -eq 90 ]]; then
      echo "WARN: postgres-test health not reported; continuing with TCP checks." >&2
    fi
  done
else
  echo "WARN: docker not found; assuming PostgreSQL is already running on 127.0.0.1:55432." >&2
fi

if ! wait_for_postgres; then
  echo "" >&2
  echo "Install Docker and run this script again, or start the lab Postgres on 127.0.0.1:55432." >&2
  exit 1
fi

if [[ "$FRESH_SCHEMA" -eq 1 ]]; then
  echo "==> --fresh-schema: destructive reset of public schema on gdc_test only …"
  confirmed=0
  if [[ "${GDC_BACKEND_FULL_TEST_RESET_CONFIRM:-}" == "YES_I_RESET_GDC_TEST_ONLY" ]]; then
    confirmed=1
  elif [[ -t 0 ]] && [[ "${CI:-}" != "true" ]]; then
    read -r -p "Type RESET GDC TEST DB to confirm: " CONFIRM
    if [[ "$CONFIRM" == "RESET GDC TEST DB" ]]; then
      confirmed=1
    fi
  fi
  if [[ "$confirmed" -ne 1 ]]; then
    echo "ERROR: fresh-schema refused. Export GDC_BACKEND_FULL_TEST_RESET_CONFIRM=YES_I_RESET_GDC_TEST_ONLY" >&2
    echo "       for non-interactive runs, or type RESET GDC TEST DB on a TTY." >&2
    exit 1
  fi
  python3 - <<'PY' || exit 1
import os
import sys

try:
    import psycopg2
except ImportError:
    print("ERROR: psycopg2 is required.", file=sys.stderr)
    sys.exit(1)

url = os.environ["TEST_DATABASE_URL"]
conn = psycopg2.connect(url)
conn.autocommit = True
cur = conn.cursor()
cur.execute("DROP SCHEMA IF EXISTS public CASCADE")
cur.execute("CREATE SCHEMA public")
cur.execute("GRANT ALL ON SCHEMA public TO PUBLIC")
cur.execute("GRANT ALL ON SCHEMA public TO CURRENT_USER")
cur.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO CURRENT_USER")
cur.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO CURRENT_USER")
cur.close()
conn.close()
print("  DROP/CREATE SCHEMA public complete.")
PY
fi

echo "==> Alembic upgrade head …"
if ! DATABASE_URL="$TEST_DATABASE_URL" python3 -m alembic upgrade head; then
  echo "" >&2
  echo "Alembic failed. If the database has drift (tables without alembic_version), re-run with:" >&2
  echo "  GDC_BACKEND_FULL_TEST_RESET_CONFIRM=YES_I_RESET_GDC_TEST_ONLY $0 --fresh-schema" >&2
  exit 1
fi

echo "==> Waiting for WireMock …"
for i in $(seq 1 60); do
  if curl -sf "${WIREMOCK_BASE_URL}/__admin/mappings" >/dev/null 2>&1; then
    echo "  WireMock OK at $WIREMOCK_BASE_URL"
    break
  fi
  sleep 1
  if [[ "$i" -eq 60 ]]; then
    echo "ERROR: WireMock not reachable at $WIREMOCK_BASE_URL" >&2
    exit 1
  fi
done

echo "==> Seeding source E2E fixtures (MinIO / fixture PostgreSQL / SFTP) …"
bash "$ROOT/scripts/testing/source-e2e/seed-fixtures.sh"

echo "==> pytest tests/ -q --tb=short …"
exec python3 -m pytest tests/ -q --tb=short
