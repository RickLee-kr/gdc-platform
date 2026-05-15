#!/usr/bin/env bash
# Full WireMock E2E regression (fail-fast); uses isolated test stack URLs by default.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/testing/_env.sh"
cd "$ROOT"
mkdir -p .test-history/latest .test-history/regression .test-history/artifacts/regression
JUNIT=".test-history/latest/regression-junit.xml"
LOG=".test-history/latest/regression-last.log"
export WIREMOCK_BASE_URL
export TEST_DATABASE_URL
set +e
python3 -m pytest -m e2e_regression -v --tb=short -x \
  --junitxml="$JUNIT" \
  tests/test_wiremock_template_e2e.py \
  tests/test_e2e_regression_matrix.py \
  tests/test_e2e_syslog_delivery.py \
  tests/test_wiremock_integration.py 2>&1 | tee "$LOG"
rc=${PIPESTATUS[0]}
set -e
python3 "$ROOT/scripts/testing/py/junit_summary.py" "$JUNIT" --text || true
python3 "$ROOT/scripts/testing/py/junit_summary.py" "$JUNIT" --markdown ".test-history/latest/regression-summary.md" || true
if [[ "$rc" -ne 0 ]]; then
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  art=".test-history/artifacts/regression/$ts"
  mkdir -p "$art"
  tail -n 200 "$LOG" >"$art/pytest-tail.txt" 2>/dev/null || true
  docker compose -f "$GDC_TEST_COMPOSE_FILE" logs --no-color --tail=400 postgres-test wiremock-test 2>/dev/null >"$art/compose-tail.txt" || true
fi
exit "$rc"
