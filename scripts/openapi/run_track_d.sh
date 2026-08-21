#!/usr/bin/env bash
# Data Relay QA Track D: deterministic OpenAPI export + route audit + Schemathesis PoC.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
export PYTHONPATH="${PYTHONPATH:-.}"
export REQUIRE_AUTH="${REQUIRE_AUTH:-false}"
export APP_ENV="${APP_ENV:-development}"
export DATABASE_URL="${DATABASE_URL:-postgresql://gdc:gdc@127.0.0.1:55441/gdc_pytest}"
export SECRET_KEY="${SECRET_KEY:-openapi-export-dev-secret}"
export JWT_SECRET_KEY="${JWT_SECRET_KEY:-openapi-export-dev-secret}"
BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"

python3 scripts/openapi/export_openapi.py --print-summary
python3 scripts/openapi/audit_openapi_routes.py --schema artifacts/openapi/openapi.json
python3 scripts/openapi/schemathesis_poc.py --base-url "$BASE_URL" --out artifacts/openapi/schemathesis-poc.json
