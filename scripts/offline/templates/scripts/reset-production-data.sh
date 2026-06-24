#!/usr/bin/env bash
# Delete all Data Relay platform containers, networks, and named volumes for a clean reinstall.
# Requires explicit YES confirmation.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/_common.sh
source "$SCRIPT_DIR/_common.sh"

OFFLINE_PACKAGE_ROOT="$(offline_resolve_package_root "$SCRIPT_DIR")"
export OFFLINE_PACKAGE_ROOT

COMPOSE_FILE="$(offline_compose_file)"
ENV_FILE="$(offline_env_file)"

die() { echo "ERROR: $*" >&2; exit 1; }

[[ -f "$COMPOSE_FILE" ]] || die "Compose file not found: $COMPOSE_FILE"

echo "============================================================"
echo "Data Relay — production data reset (offline package)"
echo "============================================================"
echo ""
echo "Package root:     $OFFLINE_PACKAGE_ROOT"
echo "Compose file:     $COMPOSE_FILE"
echo "Environment file: $ENV_FILE"
echo ""
echo "This will STOP and REMOVE:"
echo "  - Compose project: gdc-platform (name from docker-compose.offline.yml)"
echo "  - Services: postgres, api, frontend, reverse-proxy"
echo "  - Named volumes:"
echo "      gdc_platform_postgres_data  (all database data)"
echo "      gdc_platform_tls            (generated TLS material)"
echo "      gdc_platform_nginx          (nginx runtime config)"
echo "  - Attached containers and project networks"
echo ""
echo "Backups are NOT created. This matches the offline reinstall policy."
echo ""

offline_confirm_destructive "Type YES to delete all platform data and containers:"

if [[ -f "$ENV_FILE" ]]; then
  echo "[$(offline_ts)] Stopping stack and removing volumes (docker compose down -v)..."
  offline_compose down -v --remove-orphans || true
else
  echo "[$(offline_ts)] No $ENV_FILE — removing containers/volumes by known names..."
  docker rm -f gdc-platform-postgres gdc-platform-api gdc-platform-frontend gdc-platform-reverse-proxy 2>/dev/null || true
  docker volume rm -f gdc_platform_postgres_data gdc_platform_tls gdc_platform_nginx 2>/dev/null || true
fi

# Legacy installs from docker-compose.platform.yml may use the same volume names; already covered.
# HTTPS-only stack (project gdc-platform-https) is a separate project — list for operator awareness.
if docker ps -a --format '{{.Names}}' | grep -q 'gdc-platform-https'; then
  echo ""
  echo "NOTE: gdc-platform-https containers still exist (deploy/docker-compose.https.yml project)."
  echo "      Remove them separately if you migrated from the HTTPS-only stack."
fi

echo ""
echo "Production data reset complete. Run scripts/install-offline.sh for a fresh install."
