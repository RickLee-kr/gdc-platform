#!/usr/bin/env bash
# Run Alembic migrations against the platform catalog from host shell or compose.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/.env"
PLATFORM_COMPOSE_FILE="$ROOT/docker-compose.platform.yml"
PLATFORM_OVERLAY="$ROOT/docker-compose.platform.dev-validation.yml"
PLATFORM_PG_PORT="${GDC_PLATFORM_POSTGRES_HOST_PORT:-55432}"

usage() {
  cat <<'EOF'
Usage: ./scripts/dev/alembic-upgrade.sh [--host | --compose]

  --host      Run alembic on the host (maps compose postgres hostname to 127.0.0.1:55432 when needed)
  --compose   Run inside the api container (default when platform stack is up)

If neither flag is set: use compose when gdc-platform-api is running, else host.

See docs/dev/database-url-resolution.md
EOF
}

MODE=""
for arg in "$@"; do
  case "$arg" in
    --host) MODE="host" ;;
    --compose) MODE="compose" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $arg" >&2; exit 1 ;;
  esac
done

if [[ -z "$MODE" ]]; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'gdc-platform-api'; then
    MODE="compose"
  else
    MODE="host"
  fi
fi

if [[ "$MODE" == "compose" ]]; then
  exec docker compose -f "$PLATFORM_COMPOSE_FILE" -f "$PLATFORM_OVERLAY" exec -T api alembic upgrade head
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

export GDC_HOST_DATABASE_URL="${GDC_HOST_DATABASE_URL:-postgresql://gdc:gdc@127.0.0.1:${PLATFORM_PG_PORT}/gdc}"
export DATABASE_URL="${DATABASE_URL:-$GDC_HOST_DATABASE_URL}"

cd "$ROOT"
python3 -m alembic upgrade head
