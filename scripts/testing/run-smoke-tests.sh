#!/usr/bin/env bash
# Fail-fast WireMock smoke E2E (same selection as scripts/test-e2e-smoke.sh; test-stack ports).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/testing/_env.sh"
cd "$ROOT"
mkdir -p .test-history/latest .test-history/artifacts/smoke
JUNIT=".test-history/latest/smoke-junit.xml"
LOG=".test-history/latest/smoke-last.log"
export WIREMOCK_BASE_URL
export TEST_DATABASE_URL
set +e
python3 -m pytest -m e2e_smoke -v --tb=short -x \
  --junitxml="$JUNIT" \
  tests/test_wiremock_template_e2e.py \
  tests/test_e2e_syslog_delivery.py 2>&1 | tee "$LOG"
rc=${PIPESTATUS[0]}
set -e
python3 "$ROOT/scripts/testing/py/junit_summary.py" "$JUNIT" --text || true
python3 "$ROOT/scripts/testing/py/junit_summary.py" "$JUNIT" --markdown ".test-history/latest/smoke-summary.md" || true
python3 "$ROOT/scripts/testing/py/flaky_tracker.py" update --junit "$JUNIT" --state ".test-history/flaky-state.json" --summary ".test-history/flaky-summary.txt" || true
if [[ "$rc" -ne 0 ]]; then
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  art=".test-history/artifacts/smoke/$ts"
  mkdir -p "$art"
  tail -n 200 "$LOG" >"$art/pytest-tail.txt" 2>/dev/null || true
  docker compose -f "$GDC_TEST_COMPOSE_FILE" logs --no-color --tail=200 postgres-test wiremock-test 2>/dev/null >"$art/compose-tail.txt" || true
fi
exit "$rc"
