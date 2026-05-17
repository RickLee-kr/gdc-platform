#!/usr/bin/env bash
# Canonical one-command development platform bootstrap.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.platform.yml"

app_env="${APP_ENV:-development}"
case "${app_env,,}" in
  production|prod)
    echo "Refusing to start development platform with APP_ENV=$app_env" >&2
    exit 1
    ;;
esac

echo "Building development platform..."
docker compose -f "$COMPOSE_FILE" build

echo "Starting development platform..."
docker compose -f "$COMPOSE_FILE" up -d

echo "Validating development platform readiness..."
"$ROOT/scripts/dev/validate-platform-ready.sh"
