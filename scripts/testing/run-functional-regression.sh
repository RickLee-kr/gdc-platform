#!/usr/bin/env bash
# Functional regression suite: Record Selection contract → runtime delivery (not full pytest).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/testing/_env.sh"
cd "$ROOT"
mkdir -p .test-history/latest .test-history/functional-regression

JUNIT=".test-history/latest/functional-regression-junit.xml"
LOG=".test-history/latest/functional-regression-last.log"

export WIREMOCK_BASE_URL
export TEST_DATABASE_URL

set +e
python3 -m pytest -m functional_regression -q --tb=short \
  --junitxml="$JUNIT" \
  tests/test_extraction_path_contract.py \
  tests/test_event_extraction_event_root.py \
  tests/test_functional_regression_stream_runner.py \
  tests/test_functional_regression_extraction_e2e.py 2>&1 | tee "$LOG"
rc=${PIPESTATUS[0]}
set -e

if [[ "$rc" -ne 0 ]]; then
  echo "functional regression (pytest): FAIL (see $LOG)" >&2
  exit "$rc"
fi

if [[ -d "$ROOT/frontend" ]]; then
  set +e
  (cd "$ROOT/frontend" && npm run test -- --run src/utils/eventExtractionPaths.test.ts) 2>&1 | tee -a "$LOG"
  fe_rc=${PIPESTATUS[0]}
  set -e
  if [[ "$fe_rc" -ne 0 ]]; then
    echo "functional regression (frontend extraction helpers): FAIL" >&2
    exit "$fe_rc"
  fi
fi

echo "functional regression: PASS"
