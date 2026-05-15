#!/usr/bin/env bash
# Fast backend/unit selection: excludes WireMock-marked integration by default.
# Usage: ./run-focused-tests.sh [extra pytest args]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/testing/_env.sh"
cd "$ROOT"
export TEST_DATABASE_URL
exec python3 -m pytest -m "not wiremock_integration" --tb=short -x "$@"
