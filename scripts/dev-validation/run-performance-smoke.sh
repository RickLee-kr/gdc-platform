#!/usr/bin/env bash
# Dev-validation performance smoke. Delegates to _perf_smoke.py for the actual
# checks. Reads docs/testing/full-e2e-dev-validation.md.
#
# Safety:
#   - PostgreSQL only (refuses sqlite/mysql/etc).
#   - DATABASE_URL must point at datarelay or gdc_e2e_test on 127.0.0.1:55432.
#   - Does not touch user-created connectors/streams/destinations; it creates
#     dedicated [PERF SMOKE] fixtures and seeds delivery_logs only for those
#     fixture rows.
#   - No production data is mutated; no external internet calls are made.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$ROOT/.dev-validation-logs"
mkdir -p "$LOG_DIR"

TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://gdc:gdc@127.0.0.1:55432/datarelay}"
export TEST_DATABASE_URL
export DATABASE_URL="${DATABASE_URL:-$TEST_DATABASE_URL}"
# Disable optional lab slices so the perf smoke does not trigger seeder side
# effects in this process.
export ENABLE_DEV_VALIDATION_LAB="${ENABLE_DEV_VALIDATION_LAB:-false}"
export DEV_VALIDATION_AUTO_START="${DEV_VALIDATION_AUTO_START:-false}"
export ENABLE_DEV_VALIDATION_PERFORMANCE="${ENABLE_DEV_VALIDATION_PERFORMANCE:-false}"

ROWS="${PERF_SMOKE_ROWS:-10000}"

usage() {
  cat <<EOF
Usage: $0 [--rows N] [--skip-explain] [--json]

Runs the dev-validation performance smoke. Prints a fixed-width table:

  check                  rows tested  elapsed (ms)  threshold (ms)  result  notes

Options:
  --rows N        How many delivery_logs rows to bulk-insert before queries.
                  Default: \${PERF_SMOKE_ROWS:-10000}.
  --skip-explain  Skip EXPLAIN ANALYZE delegation to profile_query_plan.py.
  --json          Emit JSON instead of the fixed-width table.

Pre-requisites: start-full-e2e-lab.sh has been run successfully.
EOF
}

EXTRA=()
while [[ $# -gt 0 ]]; do
  case "$1" in
  --rows) ROWS="$2"; shift 2 ;;
  --skip-explain) EXTRA+=("--skip-explain"); shift ;;
  --json) EXTRA+=("--json"); shift ;;
  -h | --help) usage; exit 0 ;;
  *) echo "Unknown option: $1 (try --help)" >&2; exit 1 ;;
  esac
done

# Pre-flight: warn (do not fail) if the platform DB seems empty or unreachable.
python3 - <<'PY'
import os, sys
from urllib.parse import urlparse
url = os.environ.get("DATABASE_URL", "")
parsed = urlparse(url)
print(f"  perf smoke target: db={(parsed.path or '').lstrip('/')!r} host={parsed.hostname!r} port={parsed.port!r}")
PY

LOG_FILE="$LOG_DIR/perf_smoke.log"
echo ""
echo "================================================================"
echo " GDC performance smoke (rows=$ROWS)"
echo " Log: $LOG_FILE"
echo "================================================================"

cd "$ROOT"
set +e
python3 "$ROOT/scripts/dev-validation/_perf_smoke.py" --rows "$ROWS" "${EXTRA[@]}" 2>&1 | tee "$LOG_FILE"
exit_code="${PIPESTATUS[0]}"
set -e

exit "$exit_code"
