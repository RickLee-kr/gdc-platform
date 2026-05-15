#!/usr/bin/env bash
# WireMock E2E focused on checkpoint semantics and related delivery failures.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export WIREMOCK_BASE_URL="${WIREMOCK_BASE_URL:-http://127.0.0.1:18080}"
echo "== GDC E2E checkpoint (pytest -m e2e_checkpoint) =="
python3 -m pytest -m e2e_checkpoint -v --tb=short -x \
  tests/test_e2e_regression_matrix.py \
  tests/test_wiremock_template_e2e.py
echo "== E2E checkpoint OK =="
