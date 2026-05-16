#!/usr/bin/env bash
# Dev Validation Lab — simplified start command.
#
# One command brings up everything an operator needs to see the lab in the UI:
#   - Docker test stack (postgres / wiremock / webhook echo / syslog sink / MinIO / fixture PG / SFTP)
#   - Alembic migrations against the test DB
#   - Source E2E fixture data + idempotent [DEV E2E] catalog seed (unless SKIP_VISIBLE_E2E_SEED=1)
#   - Backend uvicorn with ENABLE_DEV_VALIDATION_LAB=true + DEV_VALIDATION_AUTO_START=true
#   - Vite dev server pointed at the lab API
#   - API verification for [DEV VALIDATION] / dev_lab markers and (when seeded) [DEV E2E] connectors
#
# Underlying implementation lives in scripts/dev-validation/start-dev-validation-lab.sh.
# This wrapper exists so operators only need to remember three commands
# (start / status / stop). It also normalizes a clear "schema drift" message and
# prints the convenience commands for status/stop on success.
#
# Production safety: lab seeding is forced off when APP_ENV is production/prod
# (see app/dev_validation_lab/seeder.py:lab_effective). This script targets the
# isolated lab Postgres on 127.0.0.1:55432/datarelay and never touches production.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Isolated lab catalog only. Do not inherit DATABASE_URL / TEST_DATABASE_URL from the
# shell or from a sourced .env — seeds run with TEST_DATABASE_URL while uvicorn reads
# DATABASE_URL; both must be this URL or the seed API check / UI will disagree.
export TEST_DATABASE_URL="postgresql://gdc:gdc@127.0.0.1:55432/datarelay"
export DATABASE_URL="$TEST_DATABASE_URL"

UNDERLYING="$ROOT/scripts/dev-validation/start-dev-validation-lab.sh"
LOG_DIR="$ROOT/.dev-validation-logs"
ALEMBIC_LOG="$LOG_DIR/alembic_upgrade.log"
BACKEND_LOG="$LOG_DIR/backend.log"

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START_SELF="$THIS_DIR/start.sh"
STATUS_SELF="$THIS_DIR/status.sh"
STOP_SELF="$THIS_DIR/stop.sh"
RESET_DB_SELF="$THIS_DIR/reset-db.sh"

if [[ ! -x "$UNDERLYING" ]]; then
  echo "ERROR: cannot execute $UNDERLYING" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"

# Forward all argv to the underlying script. Capture its exit code so we can
# emit a single clear "reset" hint on schema drift instead of dumping a long
# diagnostic block (the underlying script already wrote that to the log).
set +e
"$UNDERLYING" "$@"
EC=$?
set -e

if [[ $EC -eq 0 ]]; then
  cat <<EOF

============================================================
  Dev Validation Lab is running.
============================================================
  Frontend:  http://127.0.0.1:5173
  Backend:   http://127.0.0.1:8000/docs   (API base: http://127.0.0.1:8000/api/v1)

  Connectors / Streams lists include idempotent "[DEV E2E] …" rows after each
  start unless you set SKIP_VISIBLE_E2E_SEED=1 (source fixtures + catalog seed skipped).

  Status:    $STATUS_SELF
  Stop:      $STOP_SELF --with-docker
  Restart:   $START_SELF
============================================================
EOF
  exit 0
fi

# Non-zero exit. If alembic upgrade failed (most common cause is datarelay having
# tables but no alembic_version row, or version drift after a partial reset),
# emit one explicit reset command and stop. Do not auto-run anything destructive.
SCHEMA_DRIFT=0
if [[ -f "$ALEMBIC_LOG" ]]; then
  if grep -qiE 'already exists|duplicatetable|relation .* already exists|alembic_version.*does not exist|undefinedtable.*alembic_version|target database is not up to date' "$ALEMBIC_LOG" 2>/dev/null; then
    SCHEMA_DRIFT=1
  fi
fi

echo "" >&2
echo "============================================================" >&2
echo "  Dev Validation Lab failed to start (exit $EC)." >&2
echo "============================================================" >&2

if [[ "$SCHEMA_DRIFT" -eq 1 ]]; then
  cat >&2 <<EOF
  Detected schema drift on the isolated lab database (datarelay).
  Alembic cannot upgrade safely. Stop here — do NOT retry silently.

  If you ran $RESET_DB_SELF before PostgreSQL was running (connection refused),
  that reset did not drop anything — run it again now that Docker is up.

  Run this exactly (resets ONLY datarelay on 127.0.0.1:55432, requires
  typing 'RESET DATARELAY DB' to confirm):

    $RESET_DB_SELF

  Then start again:

    $START_SELF

  Migration log: $ALEMBIC_LOG
EOF
  exit $EC
fi

# Other failure (Docker not running, backend crashed, etc.). Point operators at
# the captured logs and the status command, but never auto-reset.
cat >&2 <<EOF
  Logs to inspect:
    $BACKEND_LOG
    $ALEMBIC_LOG  (only present if migrations were attempted)

  Quick triage:
    $STATUS_SELF

  Common causes:
    - Docker daemon not running         (docker ps)
    - Port already in use               (8000 / 5173 / 55432)
    - Missing dependencies              (alembic, uvicorn, npm)

  Do NOT run $RESET_DB_SELF unless this report explicitly says
  schema drift was detected — that command erases datarelay.
EOF
exit $EC
