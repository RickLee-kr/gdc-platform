#!/usr/bin/env bash
# WireMock E2E focused on authentication paths.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export WIREMOCK_BASE_URL="${WIREMOCK_BASE_URL:-http://127.0.0.1:18080}"
echo "== GDC E2E auth (pytest -m e2e_auth) =="
python3 -m pytest -m e2e_auth -v --tb=short -x \
  tests/test_e2e_regression_matrix.py \
  tests/test_wiremock_template_e2e.py \
  tests/test_wiremock_integration.py
echo "== E2E auth OK =="
