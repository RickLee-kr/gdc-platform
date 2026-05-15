#!/usr/bin/env bash
# Create a compressed PostgreSQL logical dump before upgrades. Never deletes volumes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_REL="${GDC_RELEASE_COMPOSE_FILE:-docker-compose.platform.yml}"
COMPOSE="$ROOT/$COMPOSE_REL"
BACKUP_ROOT="${GDC_BACKUP_DIR:-$ROOT/deploy/backups}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_NAME="gdc_pg_${TS}.sql.gz"
DUMP_PATH="$BACKUP_ROOT/$DUMP_NAME"
LOG_PATH="$BACKUP_ROOT/backup_${TS}.log"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_PATH"; }

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose (v2 plugin) is required." >&2
  exit 1
fi

if [[ ! -f "$COMPOSE" ]]; then
  echo "Compose file not found: $COMPOSE" >&2
  exit 1
fi

# Backup directory must stay under repository root (refuse production-dangerous host paths).
mkdir -p "$BACKUP_ROOT"
BACKUP_RESOLVED="$(cd "$BACKUP_ROOT" && pwd)"
ROOT_RESOLVED="$(cd "$ROOT" && pwd)"
if [[ "$BACKUP_RESOLVED" != "$ROOT_RESOLVED"/* ]]; then
  echo "Refusing: GDC_BACKUP_DIR / deploy/backups must resolve under repository root." >&2
  echo "  ROOT=$ROOT_RESOLVED" >&2
  echo "  BACKUP_ROOT=$BACKUP_RESOLVED" >&2
  exit 3
fi

case "$BACKUP_RESOLVED" in
  /|/bin|/boot|/dev|/etc|/lib|/lib64|/proc|/sys|/usr|/var)
    echo "Refusing: backup path looks like a system root path." >&2
    exit 3
    ;;
  /tmp|/tmp/*|/var/tmp|/var/tmp/*)
    echo "Refusing: backup path under /tmp or /var/tmp is not allowed." >&2
    exit 3
    ;;
esac

cd "$ROOT"
PG_CID="$(docker compose -f "$COMPOSE_REL" ps -q postgres 2>/dev/null | head -n1 || true)"
if [[ -z "$PG_CID" ]]; then
  log "ERROR: postgres service is not running. Start the stack before backup, or run pg_dump manually."
  exit 4
fi

DB_NAME="${GDC_BACKUP_DB_NAME:-gdc}"
DB_USER="${GDC_BACKUP_DB_USER:-gdc}"

log "Starting pg_dump for database=$DB_NAME user=$DB_USER container=$PG_CID"
docker exec "$PG_CID" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl | gzip -c >"$DUMP_PATH"
log "Wrote $DUMP_PATH ($(du -h "$DUMP_PATH" | cut -f1))"
log "Done."
