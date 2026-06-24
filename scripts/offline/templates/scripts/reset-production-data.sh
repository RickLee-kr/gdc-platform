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
COMPOSE_PROJECT="$(offline_compose_project_name)"

die() { echo "ERROR: $*" >&2; exit 1; }

[[ -f "$COMPOSE_FILE" ]] || die "Compose file not found: $COMPOSE_FILE"

echo "============================================================"
echo "Data Relay — production data reset (offline package)"
echo "============================================================"
echo ""
echo "Package root:     $OFFLINE_PACKAGE_ROOT"
echo "Compose file:     $COMPOSE_FILE"
echo "Compose project:  $COMPOSE_PROJECT"
echo "Environment file: $ENV_FILE"
echo ""
echo "=== WILL BE DELETED ==="
echo ""
echo "Containers (fixed names):"
echo "  - gdc-platform-postgres"
echo "  - gdc-platform-api"
echo "  - gdc-platform-frontend"
echo "  - gdc-platform-reverse-proxy"
echo ""
echo "Named volumes:"
echo "  - ${COMPOSE_PROJECT}_gdc_platform_postgres_data  (alias: gdc_platform_postgres_data)"
echo "  - ${COMPOSE_PROJECT}_gdc_platform_tls            (alias: gdc_platform_tls)"
echo "  - ${COMPOSE_PROJECT}_gdc_platform_nginx          (alias: gdc_platform_nginx)"
echo "  Note: all PostgreSQL data (connectors, streams, routes, users) lives in postgres_data."
echo ""
echo "Networks (typical):"
echo "  - ${COMPOSE_PROJECT}_default"
echo "  (removed by: docker compose down -v)"
echo ""
echo "=== NOT DELETED ==="
echo ""
echo "  - Loaded Docker images (gdc-platform-api:offline, frontend, reverse-proxy, postgres)"
echo "  - packages/docker/debs/*.deb"
echo "  - configs/.env and configs/.env.production.template"
echo "  - Application source under app/"
echo "  - images/*.tar archives"
echo "  - Separate compose project gdc-platform-https (if present)"
echo "  - Host files outside the Docker compose project"
echo ""
echo "Backups are NOT created. This matches the offline reinstall policy."
echo "See docs/offline-install-validation.md § reset impact for full detail."
echo ""

offline_confirm_destructive "Type YES to delete all platform data and containers:"

if [[ -f "$ENV_FILE" ]]; then
  echo "[$(offline_ts)] Stopping stack and removing volumes (docker compose down -v)..."
  offline_compose down -v --remove-orphans || true
else
  echo "[$(offline_ts)] No $ENV_FILE — removing containers/volumes by known names..."
  docker rm -f gdc-platform-postgres gdc-platform-api gdc-platform-frontend gdc-platform-reverse-proxy 2>/dev/null || true
  docker volume rm -f \
    gdc_platform_postgres_data gdc_platform_tls gdc_platform_nginx \
    "${COMPOSE_PROJECT}_gdc_platform_postgres_data" \
    "${COMPOSE_PROJECT}_gdc_platform_tls" \
    "${COMPOSE_PROJECT}_gdc_platform_nginx" 2>/dev/null || true
  docker network rm "${COMPOSE_PROJECT}_default" 2>/dev/null || true
fi

if docker ps -a --format '{{.Names}}' | grep -q 'gdc-platform-https'; then
  echo ""
  echo "NOTE: gdc-platform-https containers still exist (deploy/docker-compose.https.yml project)."
  echo "      Remove them separately if you migrated from the HTTPS-only stack."
fi

echo ""
echo "Production data reset complete. Run scripts/install-offline.sh for a fresh install."
