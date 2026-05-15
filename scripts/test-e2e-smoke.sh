#!/usr/bin/env bash
# Minimal WireMock E2E smoke (fast feedback after small runtime changes).
# Uses PostgreSQL from TEST_DATABASE_URL or DATABASE_URL; never drops Docker volumes.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export WIREMOCK_BASE_URL="${WIREMOCK_BASE_URL:-http://127.0.0.1:18080}"
echo "== GDC E2E smoke (pytest -m e2e_smoke) =="
echo "WIREMOCK_BASE_URL=${WIREMOCK_BASE_URL}"
python3 -m pytest -m e2e_smoke -v --tb=short -x \
  tests/test_wiremock_template_e2e.py \
  tests/test_e2e_syslog_delivery.py
echo "== E2E smoke OK =="
