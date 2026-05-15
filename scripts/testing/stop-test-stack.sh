#!/usr/bin/env bash
# Stop test compose services without removing volumes.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/testing/_env.sh"
cd "$ROOT"
export COMPOSE_PROFILES=test
docker compose -f "$GDC_TEST_COMPOSE_FILE" stop 2>/dev/null || true
echo "Test stack stopped (volumes preserved)."
