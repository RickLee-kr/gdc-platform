#!/usr/bin/env bash
# Rename PostgreSQL catalog gdc_test → datarelay in-place (preserves all data).
# Does NOT drop volumes, TRUNCATE, or reset schemas.
#
# Usage:
#   GDC_RELEASE_COMPOSE_FILE=docker-compose.platform.yml ./scripts/release/rename-catalog-gdc-test-to-datarelay.sh
#
# Idempotent: exits 0 if datarelay already exists and gdc_test is absent.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_REL="${GDC_RELEASE_COMPOSE_FILE:-docker-compose.platform.yml}"
SOURCE_DB="${GDC_RENAME_SOURCE_DB:-gdc_test}"
TARGET_DB="${GDC_RENAME_TARGET_DB:-datarelay}"
DB_USER="${GDC_RENAME_DB_USER:-gdc}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required." >&2
  exit 1
fi

cd "$ROOT"
if [[ ! -f "$ROOT/$COMPOSE_REL" ]]; then
  echo "Compose file not found: $ROOT/$COMPOSE_REL" >&2
  exit 1
fi

PG_CID="$(docker compose -f "$COMPOSE_REL" ps -q postgres 2>/dev/null | head -n1 || true)"
if [[ -z "$PG_CID" ]]; then
  echo "postgres service is not running (compose: $COMPOSE_REL)." >&2
  exit 4
fi

has_db() {
  local name="$1"
  docker exec "$PG_CID" psql -U "$DB_USER" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '$name'" 2>/dev/null | grep -qx 1
}

if has_db "$TARGET_DB" && ! has_db "$SOURCE_DB"; then
  echo "Catalog already renamed: '$TARGET_DB' exists, '$SOURCE_DB' absent (nothing to do)."
  exit 0
fi

if has_db "$TARGET_DB" && has_db "$SOURCE_DB"; then
  echo "Refusing: both '$SOURCE_DB' and '$TARGET_DB' exist. Resolve manually before re-running." >&2
  exit 3
fi

if ! has_db "$SOURCE_DB"; then
  echo "Refusing: source catalog '$SOURCE_DB' not found (and '$TARGET_DB' is missing)." >&2
  exit 3
fi

echo "Renaming PostgreSQL catalog '$SOURCE_DB' → '$TARGET_DB' (container $PG_CID)…"
echo "Stopping API containers that may hold connections to '$SOURCE_DB'…"
while IFS= read -r cid; do
  [[ -n "$cid" ]] || continue
  docker stop "$cid" >/dev/null 2>&1 || true
done < <(docker compose -f "$COMPOSE_REL" ps -q api 2>/dev/null || true)

echo "Terminating backends on '$SOURCE_DB'…"
docker exec "$PG_CID" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$SOURCE_DB' AND pid <> pg_backend_pid();" \
  >/dev/null

docker exec "$PG_CID" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "ALTER DATABASE \"$SOURCE_DB\" RENAME TO \"$TARGET_DB\";"

if ! has_db "$TARGET_DB"; then
  echo "ERROR: rename reported success but '$TARGET_DB' is not visible in pg_database." >&2
  exit 5
fi

echo "Done. Catalog is now '$TARGET_DB'. Recreate/restart the stack so Compose uses POSTGRES_DB=$TARGET_DB:"
echo "  docker compose -f $COMPOSE_REL up -d --force-recreate postgres api"
