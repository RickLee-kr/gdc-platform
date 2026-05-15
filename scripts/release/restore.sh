#!/usr/bin/env bash
# Restore PostgreSQL from a gzip-compressed pg_dump SQL file into the compose postgres service.
# Destructive: requires explicit confirmation. Never drops Docker volumes automatically.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_REL="${GDC_RELEASE_COMPOSE_FILE:-docker-compose.platform.yml}"

usage() {
  echo "Usage: RESTORE_CONFIRM=YES_I_UNDERSTAND $0 <path-to-dump.sql.gz>" >&2
  echo "Environment:" >&2
  echo "  GDC_RELEASE_COMPOSE_FILE  (default: docker-compose.platform.yml)" >&2
  echo "  GDC_RESTORE_DB_NAME       (default: gdc; allowlist: gdc, gdc_test)" >&2
  echo "  GDC_RESTORE_DB_USER       (default: gdc)" >&2
  exit 2
}

if [[ "${RESTORE_CONFIRM:-}" != "YES_I_UNDERSTAND" ]]; then
  echo "Refusing restore without RESTORE_CONFIRM=YES_I_UNDERSTAND" >&2
  usage
fi

DUMP="${1:-}"
if [[ -z "$DUMP" ]]; then
  echo "Dump file missing: ${DUMP:-}" >&2
  usage
fi
if command -v realpath >/dev/null 2>&1; then
  DUMP="$(realpath "$DUMP")"
fi
if [[ ! -f "$DUMP" ]]; then
  echo "Dump file missing or not a file: ${DUMP:-}" >&2
  usage
fi

ALLOWED_DB="${GDC_RESTORE_DB_NAME:-gdc}"
ALLOWED_USER="${GDC_RESTORE_DB_USER:-gdc}"

if [[ "$ALLOWED_DB" != "gdc" && "$ALLOWED_DB" != "gdc_test" ]]; then
  echo "Refusing: GDC_RESTORE_DB_NAME must be gdc or gdc_test (unknown DB target guard)." >&2
  exit 3
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose (v2 plugin) is required." >&2
  exit 1
fi

cd "$ROOT"
COMPOSE="$ROOT/$COMPOSE_REL"
if [[ ! -f "$COMPOSE" ]]; then
  echo "Compose file not found: $COMPOSE" >&2
  exit 1
fi

PG_CID="$(docker compose -f "$COMPOSE_REL" ps -q postgres 2>/dev/null | head -n1 || true)"
if [[ -z "$PG_CID" ]]; then
  echo "postgres service is not running." >&2
  exit 4
fi

echo "This will replace data in database '$ALLOWED_DB' on the compose postgres service."
echo "  Dump: $DUMP"
echo "  Compose: $COMPOSE_REL"
read -r -p "Type the database name to proceed ($ALLOWED_DB): " typed
if [[ "$typed" != "$ALLOWED_DB" ]]; then
  echo "Confirmation mismatch; aborting." >&2
  exit 5
fi

log_restore() { echo "[restore] $*"; }

log_restore "Terminating connections to $ALLOWED_DB (if any)..."
docker exec "$PG_CID" psql -U "$ALLOWED_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$ALLOWED_DB' AND pid <> pg_backend_pid();" \
  >/dev/null || true

log_restore "Dropping and recreating database $ALLOWED_DB..."
docker exec "$PG_CID" psql -U "$ALLOWED_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$ALLOWED_DB\";"
docker exec "$PG_CID" psql -U "$ALLOWED_USER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$ALLOWED_DB\" OWNER \"$ALLOWED_USER\";"

log_restore "Restoring from gzip SQL..."
gunzip -c "$DUMP" | docker exec -i "$PG_CID" psql -U "$ALLOWED_USER" -d "$ALLOWED_DB" -v ON_ERROR_STOP=1

log_restore "Restore finished. Run alembic upgrade head if schema drift is possible."
