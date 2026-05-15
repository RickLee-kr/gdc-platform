#!/usr/bin/env bash
# DESTRUCTIVE (gdc_test only): drop public schema, recreate, run alembic upgrade head.
# Never run automatically. Optional --stamp-existing stamps head without dropping.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

DEFAULT_URL="postgresql://gdc:gdc@127.0.0.1:55432/gdc_test"
export DATABASE_URL="${DATABASE_URL:-$DEFAULT_URL}"

STAMP_ONLY=false
while [[ $# -gt 0 ]]; do
  case "$1" in
  --stamp-existing)
    STAMP_ONLY=true
    ;;
  -h | --help)
    echo "Usage: DATABASE_URL=... $0 [--stamp-existing]"
    echo ""
    echo "  Resets ONLY the Dev Validation lab test database (default: $DEFAULT_URL)."
    echo "  Waits up to 120s for PostgreSQL (start Docker / lab stack first)."
    echo "  Requires:"
    echo "    - database name exactly: gdc_test"
    echo "    - host: 127.0.0.1, localhost, or ::1"
    echo "    - port: 55432 (docker-compose.test.yml mapped Postgres)"
    echo "    - user: gdc"
    echo "    - type exactly: RESET GDC TEST DB"
    echo ""
    echo "  --stamp-existing  Run 'alembic stamp head' only (no DROP). For known-good"
    echo "                    schemas missing alembic_version — misuse can corrupt history."
    echo ""
    echo "  Does NOT remove Docker volumes."
    exit 0
    ;;
  *)
    echo "Unknown option: $1 (try --help)" >&2
    exit 1
    ;;
  esac
  shift
done

echo "================================================================"
echo "  Dev Validation Lab — test database reset / repair"
echo "================================================================"
echo "  DATABASE_URL=$DATABASE_URL"
echo ""

python3 - <<'PY' || exit 1
import os
import sys
from urllib.parse import urlparse

u = urlparse(os.environ.get("DATABASE_URL", ""))
if u.scheme not in ("postgresql", "postgres"):
    print("ERROR: DATABASE_URL must be a postgresql URL.", file=sys.stderr)
    sys.exit(1)
host = (u.hostname or "").lower()
port = u.port
user = u.username or ""
path = (u.path or "").strip("/")
db = path.split("/")[0] if path else ""

if db != "gdc_test":
    print(f"ERROR: database name must be exactly 'gdc_test' (got {db!r}).", file=sys.stderr)
    sys.exit(1)
if user != "gdc":
    print(f"ERROR: user must be 'gdc' for this lab script (got {user!r}).", file=sys.stderr)
    sys.exit(1)
if port != 55432:
    print(f"ERROR: port must be 55432 (lab test Postgres). Got {port!r}.", file=sys.stderr)
    sys.exit(1)
if host not in ("127.0.0.1", "localhost", "::1"):
    print(f"ERROR: host must be 127.0.0.1, localhost, or ::1 (got {host!r}).", file=sys.stderr)
    sys.exit(1)
print("  Safety checks: OK (gdc_test @ lab test host:port, user gdc).")
PY

echo ""
echo "Waiting for PostgreSQL to accept connections (up to 120s)…"
python3 - <<'PY' || exit 1
import os
import sys
import time

try:
    import psycopg2
except ImportError:
    print("ERROR: psycopg2 is required (install project dependencies).", file=sys.stderr)
    sys.exit(1)

url = os.environ["DATABASE_URL"]
deadline = time.monotonic() + 120.0
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
print("", file=sys.stderr)
print("  The lab database runs inside Docker. Start PostgreSQL first, for example:", file=sys.stderr)
print(
    "    docker compose -p gdc-platform-test -f docker-compose.dev-validation.yml "
    "--profile dev-validation up -d postgres-test",
    file=sys.stderr,
)
print("  Then run this reset again.", file=sys.stderr)
print("", file=sys.stderr)
print(
    "  If you already ran ./scripts/validation-lab/start.sh and saw DuplicateTable / schema drift, "
    "Docker is up — run this reset now, then start.sh again.",
    file=sys.stderr,
)
sys.exit(1)
PY

echo ""
echo "WARNING: This targets the disposable Dev Validation test DB only."
echo "If you need to keep the current gdc_test contents, back up before confirming, e.g.:"
echo "  pg_dump \"\$DATABASE_URL\" --format=custom --file=gdc_test_backup.dump"
if [[ "$STAMP_ONLY" == true ]]; then
  echo "Mode: --stamp-existing (alembic stamp head, NO schema drop)."
  echo "Only use when you are certain the schema already matches migration head."
else
  echo "Mode: FULL RESET — DROP SCHEMA public CASCADE (all data in public schema removed)."
fi
echo ""
read -r -p "Type RESET GDC TEST DB to confirm: " CONFIRM
if [[ "$CONFIRM" != "RESET GDC TEST DB" ]]; then
  echo "Aborted (confirmation did not match)." >&2
  exit 1
fi

if [[ "$STAMP_ONLY" == true ]]; then
  echo ""
  echo "Running: alembic stamp head"
  if command -v alembic >/dev/null 2>&1; then
    alembic stamp head
  else
    python3 -m alembic stamp head
  fi
  echo ""
  echo "================================================================"
  echo "  Stamped head (no DDL). Verify with: alembic current"
  echo "================================================================"
  if command -v alembic >/dev/null 2>&1; then
    alembic current
    alembic heads
  else
    python3 -m alembic current
    python3 -m alembic heads
  fi
  exit 0
fi

echo ""
echo "Connecting and resetting schema public..."
python3 - <<'PY'
import os
import sys

try:
    import psycopg2
except ImportError:
    print("ERROR: psycopg2 is required (install project dependencies).", file=sys.stderr)
    sys.exit(1)

url = os.environ["DATABASE_URL"]
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

echo ""
echo "Running: alembic upgrade head"
if command -v alembic >/dev/null 2>&1; then
  alembic upgrade head
else
  python3 -m alembic upgrade head
fi

echo ""
echo "================================================================"
echo "  Reset complete."
echo "================================================================"
if command -v alembic >/dev/null 2>&1; then
  echo "Alembic current:"
  alembic current
  echo "Alembic head(s):"
  alembic heads
else
  echo "Alembic current:"
  python3 -m alembic current
  echo "Alembic head(s):"
  python3 -m alembic heads
fi
