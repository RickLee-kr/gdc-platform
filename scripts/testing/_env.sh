# shellcheck shell=bash
# Source from other scripts in this directory (not executed standalone).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
export GDC_REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export COMPOSE_PROFILES="${COMPOSE_PROFILES:-test}"
export GDC_TEST_COMPOSE_FILE="${GDC_TEST_COMPOSE_FILE:-$GDC_REPO_ROOT/docker-compose.test.yml}"
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://gdc:gdc@127.0.0.1:55432/gdc_test}"
export WIREMOCK_BASE_URL="${WIREMOCK_BASE_URL:-http://127.0.0.1:28080}"
