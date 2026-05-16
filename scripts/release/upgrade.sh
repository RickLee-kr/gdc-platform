#!/usr/bin/env bash
# Upgrade: mandatory backup, rebuild images, migrate, rolling-style service refresh.
# Persistent volumes are preserved. Never runs "docker compose down -v".
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=scripts/release/_release_postgres_catalog.sh
source "$SCRIPT_DIR/_release_postgres_catalog.sh"
COMPOSE_REL="${GDC_RELEASE_COMPOSE_FILE:-docker-compose.platform.yml}"

die() { echo "ERROR: $*" >&2; exit 1; }

require_docker() {
  command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH."
  docker compose version >/dev/null 2>&1 || die "docker compose (v2 plugin) is required."
}

wait_service_running_or_healthy() {
  local svc="$1"
  local deadline="${2:-120}"
  local waited=0
  while [[ "$waited" -lt "$deadline" ]]; do
    local cid
    cid="$(docker compose -f "$COMPOSE_REL" ps -q "$svc" 2>/dev/null | head -n1 || true)"
    if [[ -n "$cid" ]]; then
      local health
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo "unknown")"
      if [[ "$health" == "healthy" ]]; then
        return 0
      fi
      if [[ "$health" == "none" ]]; then
        local running
        running="$(docker inspect --format '{{.State.Running}}' "$cid" 2>/dev/null || echo false)"
        if [[ "$running" == "true" ]]; then
          return 0
        fi
      fi
    fi
    sleep 3
    waited=$((waited + 3))
  done
  die "Service '$svc' did not become running/healthy within ${deadline}s (check: docker compose -f $COMPOSE_REL ps && docker compose -f $COMPOSE_REL logs $svc)"
}

mkdir -p "$ROOT/deploy/backups"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$ROOT/deploy/backups/upgrade_${TS}.log"

exec > >(tee -a "$LOG") 2>&1

echo "=== GDC platform upgrade $TS ==="
echo "Compose: $COMPOSE_REL"
echo "Log: $LOG"

require_docker
cd "$ROOT"
[[ -f "$ROOT/$COMPOSE_REL" ]] || die "Compose file not found: $ROOT/$COMPOSE_REL"

_backup_db="$(gdc_release_resolve_postgres_db_name "$ROOT" "$COMPOSE_REL" "${GDC_BACKUP_DB_NAME:-}")"
echo "Pre-upgrade backup will run pg_dump against database: $_backup_db (override with GDC_BACKUP_DB_NAME if needed)."

echo "[1/5] Pre-upgrade backup (mandatory)..."
if ! "$SCRIPT_DIR/backup-before-upgrade.sh"; then
  die "Backup failed; aborting upgrade (no migrations or image refreshes were applied after this point)."
fi

echo "[2/5] Pull base images and rebuild application images..."
docker compose -f "$COMPOSE_REL" build --pull

echo "[2.5/5] Pre-upgrade migration integrity (read-only)..."
export GDC_RELEASE_COMPOSE_FILE="$COMPOSE_REL"
# shellcheck source=scripts/release/_release_migration_validate.sh
source "$SCRIPT_DIR/_release_migration_validate.sh"
set +e
docker compose -f "$COMPOSE_REL" run --rm --no-deps api python -m app.db.validate_migrations --pre-upgrade
_mig_val_rc=$?
set -e
if ! gdc_release_handle_pre_migration_validate_rc "$_mig_val_rc"; then
  echo "  Orphan alembic_version stamps (e.g. 20260513_0021_dl_parts) block safe upgrade." >&2
  echo "  Run: docker compose -f $COMPOSE_REL run --rm --no-deps api python -m app.db.validate_migrations --json" >&2
  echo "  Recovery: docs/operations/migration-recovery-runbook.md" >&2
  die "Aborting before alembic upgrade head."
fi
echo "Pre-upgrade migration integrity: OK (errors none; warnings may have been printed)."

echo "[3/5] Alembic upgrade (one-shot api container)..."
echo "  Target DATABASE_URL is injected by compose for the api service (see: docker compose -f $COMPOSE_REL config)."
docker compose -f "$COMPOSE_REL" run --rm --no-deps api alembic upgrade head
echo "Post-upgrade revision:"
docker compose -f "$COMPOSE_REL" run --rm --no-deps api alembic current || true

echo "[4/5] Rolling-style recreate (postgres, then api, then reverse-proxy when present)..."
docker compose -f "$COMPOSE_REL" up -d --no-build postgres
docker compose -f "$COMPOSE_REL" up -d --no-build api
wait_service_running_or_healthy api 150
if docker compose -f "$COMPOSE_REL" config --services 2>/dev/null | grep -qx reverse-proxy; then
  docker compose -f "$COMPOSE_REL" up -d --no-build reverse-proxy
  wait_service_running_or_healthy reverse-proxy 90
else
  echo "(No reverse-proxy service in this compose file; skipping.)"
fi

echo "[5/5] Ensure any remaining services are converged..."
docker compose -f "$COMPOSE_REL" up -d --no-build

echo ""
echo "Upgrade complete. Named Docker volumes were not removed."
echo "Rollback guidance (manual):"
echo "  1) Stop the stack without deleting volumes:"
echo "       docker compose -f $COMPOSE_REL down"
echo "  2) Restore the latest backup (destructive to the DB inside postgres):"
echo "       See docs/deployment/backup-restore.md and scripts/release/restore.sh"
echo "  3) Check out the previous Git tag or image digest, then:"
echo "       docker compose -f $COMPOSE_REL up -d --build"
echo "  4) Re-run migrations if you restored an older dump:"
echo "       docker compose -f $COMPOSE_REL run --rm --no-deps api alembic upgrade head"
echo "Backup artifacts and this log: $ROOT/deploy/backups/"
