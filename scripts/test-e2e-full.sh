#!/usr/bin/env bash
# Full WireMock E2E regression (run before milestone merges).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export WIREMOCK_BASE_URL="${WIREMOCK_BASE_URL:-http://127.0.0.1:18080}"
echo "== GDC E2E full regression (pytest -m e2e_regression) =="
echo "WIREMOCK_BASE_URL=${WIREMOCK_BASE_URL}"
python3 -m pytest -m e2e_regression -v --tb=short -x \
  tests/test_wiremock_template_e2e.py \
  tests/test_e2e_regression_matrix.py \
  tests/test_e2e_syslog_delivery.py \
  tests/test_wiremock_integration.py
echo "== E2E full regression OK =="
