#!/usr/bin/env bash
# Dev Validation Lab — destructive reset for the isolated lab database.
#
# This wraps scripts/dev-validation/reset-dev-validation-db.sh, which:
#   - Refuses to run unless DATABASE_URL points at the lab test profile
#     (host 127.0.0.1/localhost/::1, port 55432, user gdc, database datarelay).
#   - Waits up to 120s for PostgreSQL (so run after `docker compose … up`, or
#     run `./scripts/validation-lab/start.sh` once to bring containers up).
#   - Requires interactive confirmation: type 'RESET DATARELAY DB'.
#   - Drops the public schema in datarelay and re-runs `alembic upgrade head`.
#   - Never removes Docker volumes; never touches production / your dev DB.
#
# This script is intentionally separate from start.sh and is NEVER auto-invoked.
# Run it only when start.sh explicitly reports schema drift on datarelay.
# After a successful reset, run start.sh to re-apply migrations and (by default)
# re-seed MinIO/fixture-PG/SFTP objects plus idempotent [DEV E2E] catalog rows;
# set SKIP_VISIBLE_E2E_SEED=1 on start.sh to skip only the UI catalog seed step.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNDERLYING="$ROOT/scripts/dev-validation/reset-dev-validation-db.sh"
START_SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/start.sh"

if [[ ! -x "$UNDERLYING" ]]; then
  echo "ERROR: cannot execute $UNDERLYING" >&2
  exit 1
fi

set +e
"$UNDERLYING" "$@"
EC=$?
set -e

if [[ "$EC" -eq 0 ]]; then
  echo ""
  echo "  datarelay reset complete. Bring the lab back with:"
  echo "    $START_SELF"
  echo "  start.sh applies migrations if needed, seeds source fixtures (MinIO / fixture PG / SFTP),"
  echo "  then idempotently upserts [DEV E2E] UI catalog rows unless SKIP_VISIBLE_E2E_SEED=1."
fi
exit "$EC"
