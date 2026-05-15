#!/usr/bin/env bash
# Focused tests for DATABASE_QUERY / REMOTE_FILE_POLLING adapters + validation lab gates.
# Optional: start docker compose dev-validation profile and run seed-* scripts first (see docs/testing/dev-validation-lab.md).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
export DATABASE_QUERY_PG_URL="${DATABASE_QUERY_PG_URL:-postgresql://gdc_fixture:gdc_fixture_pw@127.0.0.1:55433/gdc_query_fixture}"
pytest -q \
  tests/test_remote_file_polling_unit.py \
  tests/test_database_query_validator.py \
  tests/test_database_query_adapter.py \
  tests/test_plugin_adapters.py \
  tests/test_dev_validation_lab_gates.py \
  "$@"
