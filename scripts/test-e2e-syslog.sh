#!/usr/bin/env bash
# Syslog TCP/UDP E2E delivery (local in-process receivers + WireMock HTTP source).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export WIREMOCK_BASE_URL="${WIREMOCK_BASE_URL:-http://127.0.0.1:18080}"
echo "== GDC E2E syslog delivery (e2e_delivery + e2e_regression) =="
echo "WIREMOCK_BASE_URL=${WIREMOCK_BASE_URL}"
python3 -m pytest -m "e2e_delivery and e2e_regression" -v --tb=short -x tests/test_e2e_syslog_delivery.py
echo "== E2E syslog delivery OK =="
