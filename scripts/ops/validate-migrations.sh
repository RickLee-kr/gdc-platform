#!/usr/bin/env bash
# Read-only Alembic / DATABASE_URL consistency check (no DDL, no stamp, no truncate).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_REL="${GDC_RELEASE_COMPOSE_FILE:-docker-compose.platform.yml}"
STRICT=0
PRE_UPGRADE=0
JSON_OUT=0
USE_DOCKER=auto

usage() {
  cat <<EOF
Usage: $0 [--pre-upgrade] [--strict] [--json] [--host-only]

Validates:
  - Alembic script heads in the repository
  - alembic_version row in the target PostgreSQL database
  - orphan revisions (e.g. 20260513_0021_dl_parts)
  - common DATABASE_URL mis-targeting (gdc vs gdc_test)

Exit codes: 0 ok, 1 error, 2 warnings (unless --strict).

Environment:
  GDC_RELEASE_COMPOSE_FILE  Compose file for docker mode (default: docker-compose.platform.yml)
  DATABASE_URL              Used when running on the host (--host-only)

Examples:
  $0 --pre-upgrade
  GDC_RELEASE_COMPOSE_FILE=deploy/docker-compose.https.yml $0 --host-only
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
  --pre-upgrade) PRE_UPGRADE=1 ;;
  --strict) STRICT=1 ;;
  --json) JSON_OUT=1 ;;
  --host-only) USE_DOCKER=0 ;;
  --help | -h) usage; exit 0 ;;
  *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

cd "$ROOT"

CLI_EXTRA=()
[[ "$PRE_UPGRADE" -eq 1 ]] && CLI_EXTRA+=(--pre-upgrade)
[[ "$STRICT" -eq 1 ]] && CLI_EXTRA+=(--strict)
[[ "$JSON_OUT" -eq 1 ]] && CLI_EXTRA+=(--json)

run_cli() {
  if [[ "$USE_DOCKER" != "0" ]] && command -v docker >/dev/null 2>&1 && [[ -f "$ROOT/$COMPOSE_REL" ]]; then
    export GDC_RELEASE_COMPOSE_FILE="$COMPOSE_REL"
    docker compose -f "$COMPOSE_REL" run --rm --no-deps api python -m app.db.validate_migrations "$@"
  else
    export PYTHONPATH="${ROOT}${PYTHONPATH:+:$PYTHONPATH}"
    python3 -m app.db.validate_migrations "$@"
  fi
}

echo "=== Alembic repository heads ==="
run_cli --print-alembic-heads
echo ""

if [[ "$USE_DOCKER" != "0" ]] && command -v docker >/dev/null 2>&1 && [[ -f "$ROOT/$COMPOSE_REL" ]]; then
  echo "=== alembic history (last 8, api container) ==="
  docker compose -f "$COMPOSE_REL" run --rm --no-deps api alembic history 2>/dev/null | head -8 || true
  echo ""
fi

echo "=== migration integrity ==="
set +e
run_cli "${CLI_EXTRA[@]}"
_rc=$?
set -e
exit "$_rc"
