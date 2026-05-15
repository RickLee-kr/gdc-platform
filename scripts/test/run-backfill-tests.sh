#!/usr/bin/env bash
# Run Backfill Phase 2 foundation tests against the isolated PostgreSQL test profile.
# Prerequisites: postgres-test from docker-compose.test.yml listening on host 127.0.0.1:55432.
#
# Targets only the URL in TEST_DATABASE_URL (default: gdc_test on 55432). This script
# drops and recreates the public schema before alembic so upgrade head is reliable
# even after prior pytest runs that used metadata-only resets without alembic_version.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$ROOT"
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://gdc:gdc@127.0.0.1:55432/gdc_test}"
export DATABASE_URL="$TEST_DATABASE_URL"
python3 - <<'PY'
import os
from sqlalchemy import create_engine, text

url = os.environ["TEST_DATABASE_URL"]
engine = create_engine(url, isolation_level="AUTOCOMMIT")
with engine.connect() as conn:
    conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
    conn.execute(text("CREATE SCHEMA public"))
engine.dispose()
PY
python3 -m alembic upgrade head
python3 -m pytest tests/test_backfill_foundation.py tests/test_backfill_worker_progress.py -q
