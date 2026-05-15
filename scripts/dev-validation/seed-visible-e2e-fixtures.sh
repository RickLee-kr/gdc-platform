#!/usr/bin/env bash
# Idempotent PostgreSQL seed: UI-visible "[DEV E2E]" connectors, streams, destinations, and routes
# for HTTP_API_POLLING, S3_OBJECT_POLLING, DATABASE_QUERY, REMOTE_FILE_POLLING (local lab services only).
#
# Safety:
#   - PostgreSQL catalog URL only; refuses APP_ENV production/prod.
#   - Database name must be gdc_test or gdc_e2e_test (port 55432, user gdc, loopback), or
#     gdc on loopback with --local-dev-mode (ports 5432 or 55432) — explicit disposable local catalog.
#   - Refuses DATABASE_URL substrings that look like managed/cloud hosts.
#   - Touches only rows named with prefix "[DEV E2E] " (and routes for those streams / to those destinations).
#   - No DB reset, no deletes of user entities, no internet access required.
#
# Usage:
#   ./scripts/dev-validation/seed-visible-e2e-fixtures.sh [--local-dev-mode]
#
# Integrated with the validation lab: `./scripts/validation-lab/start.sh` runs this
# automatically after migrations (unless SKIP_VISIBLE_E2E_SEED=1). You can still run
# this script manually against a running lab DB.
#
# Environment (defaults match docker-compose.test.yml + start-full-e2e-lab.sh):
#   DATABASE_URL, WIREMOCK_BASE_URL, SOURCE_E2E_*, GDC_VISIBLE_E2E_* — see docs/testing/visible-dev-e2e-fixtures.md
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
export PYTHONPATH="$ROOT${PYTHONPATH:+:$PYTHONPATH}"

EXTRA=()
for arg in "$@"; do
  case "$arg" in
  --local-dev-mode) EXTRA+=("--local-dev-mode") ;;
  -h | --help)
    sed -n '1,35p' "$0"
    exit 0
    ;;
  *)
    echo "Unknown option: $arg (use --help)" >&2
    exit 1
    ;;
  esac
done

export DATABASE_URL="${DATABASE_URL:-postgresql://gdc:gdc@127.0.0.1:55432/gdc_test}"

python3 -m app.dev_validation_lab.visible_e2e_seed "${EXTRA[@]}"
