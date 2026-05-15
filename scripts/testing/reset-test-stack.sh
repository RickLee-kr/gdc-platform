#!/usr/bin/env bash
# Explicit destructive reset: removes test compose containers and named volumes for this project only.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/testing/_env.sh"
cd "$ROOT"
export COMPOSE_PROFILES=test
echo "Removing test stack and compose-managed volumes (gdc_test data only)..."
docker compose -f "$GDC_TEST_COMPOSE_FILE" down -v
echo "Test stack reset complete."
