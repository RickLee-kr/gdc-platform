#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.offline.yml"
ENV_FILE="$SCRIPT_DIR/.env"
LOG_FILE=""

die() { echo "ERROR: $*" >&2; exit 1; }
ts() { date '+%Y-%m-%d %H:%M:%S'; }

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

init_logging() {
  local log_dir="$SCRIPT_DIR/logs"
  mkdir -p "$log_dir"
  LOG_FILE="$log_dir/reset-$(date +%Y%m%d-%H%M%S).log"
  exec > >(tee -a "$LOG_FILE") 2>&1
  echo "[$(ts)] Logging to $LOG_FILE"
}

confirm_yes() {
  local answer
  echo ""
  echo "This operation deletes only gdc-platform resources."
  echo "Type YES to continue."
  read -r answer
  [[ "$answer" == "YES" ]] || die "Aborted."
}

init_logging

echo "============================================================"
echo "Data Relay offline reset"
echo "============================================================"
echo "Target compose file: $COMPOSE_FILE"
echo ""
echo "Will delete:"
echo "  - Containers: gdc-platform-postgres, gdc-platform-api, gdc-platform-frontend, gdc-platform-reverse-proxy"
echo "  - Volume: gdc_platform_postgres_data"
echo "  - Network: gdc-platform_default"
echo ""
echo "Will NOT delete:"
echo "  - Other Docker projects/containers/images/volumes/networks"
echo "  - Offline package files (images/, docker-debs/, checksums/)"

[[ -f "$COMPOSE_FILE" ]] || die "Missing compose file: $COMPOSE_FILE"
[[ -f "$ENV_FILE" ]] || die "Missing env file: $ENV_FILE"

confirm_yes

compose down -v --remove-orphans || true

docker rm -f gdc-platform-postgres gdc-platform-api gdc-platform-frontend gdc-platform-reverse-proxy 2>/dev/null || true
docker volume rm -f gdc_platform_postgres_data 2>/dev/null || true
docker network rm gdc-platform_default 2>/dev/null || true

echo ""
echo "Reset complete. Next:"
echo "  ./offline_install/install.sh"
