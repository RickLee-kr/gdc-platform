#!/usr/bin/env bash
# Remove pytest fixture rows that leaked into the platform gdc catalog.
# Safe for production-adjacent dev stacks: never deletes [DEV VALIDATION] or [DEV E2E] rows.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${GDC_PLATFORM_COMPOSE_FILE:-$ROOT/docker-compose.platform.yml}"
PLATFORM_COMPOSE=(docker compose -f "$COMPOSE_FILE")

case "${APP_ENV:-development}" in
  production|prod)
    echo "ERROR: refusing pytest leak cleanup with APP_ENV=${APP_ENV:-}" >&2
    exit 1
    ;;
esac

echo "=== Cleanup pytest catalog leaks (platform catalog gdc) ==="
if "${PLATFORM_COMPOSE[@]}" exec -T api python - <<'PY'
from app.connectors import models as _connector_models  # noqa: F401
from app.routes import models as _route_models  # noqa: F401
from app.database import SessionLocal
from app.dev_validation_lab.pytest_catalog_cleanup import cleanup_pytest_catalog_leaks

db = SessionLocal()
try:
    result = cleanup_pytest_catalog_leaks(db)
finally:
    db.close()
print(result)
PY
then
  :
else
  echo "  API module unavailable — falling back to SQL cleanup..."
  "${PLATFORM_COMPOSE[@]}" exec -T postgres psql -U gdc -d gdc -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
CREATE TEMP TABLE pytest_leak_streams AS
  SELECT s.id
  FROM streams s
  JOIN connectors c ON c.id = s.connector_id
  WHERE c.name IN ('e2e-connector', 's3-e2e-connector')
     OR s.name IN ('e2e-stream', 's3-e2e-stream')
     OR c.name LIKE 'pytest-sr-%'
     OR c.name LIKE 'pytest-s3-%'
     OR s.name LIKE 'pytest-sr-stream-%'
     OR s.name LIKE 'pytest-s3-stream-%';
CREATE TEMP TABLE pytest_leak_connectors AS
  SELECT id FROM connectors
  WHERE name IN ('e2e-connector', 's3-e2e-connector')
     OR name LIKE 'pytest-sr-%'
     OR name LIKE 'pytest-s3-%';
DELETE FROM delivery_logs WHERE stream_id IN (SELECT id FROM pytest_leak_streams);
DELETE FROM delivery_logs WHERE route_id IN (SELECT id FROM routes WHERE stream_id IN (SELECT id FROM pytest_leak_streams));
DELETE FROM delivery_logs WHERE connector_id IN (SELECT id FROM pytest_leak_connectors);
DELETE FROM routes WHERE stream_id IN (SELECT id FROM pytest_leak_streams);
DELETE FROM mappings WHERE stream_id IN (SELECT id FROM pytest_leak_streams);
DELETE FROM enrichments WHERE stream_id IN (SELECT id FROM pytest_leak_streams);
DELETE FROM checkpoints WHERE stream_id IN (SELECT id FROM pytest_leak_streams);
DELETE FROM streams WHERE id IN (SELECT id FROM pytest_leak_streams);
DELETE FROM sources WHERE connector_id IN (SELECT id FROM pytest_leak_connectors);
DELETE FROM connectors WHERE id IN (SELECT id FROM pytest_leak_connectors);
DELETE FROM destinations d
WHERE (d.name ~ '^dest-[0-9]+$' OR d.name LIKE 'pytest-sr-dest-%' OR d.name LIKE 'pytest-s3-dest-%')
  AND NOT EXISTS (SELECT 1 FROM routes r WHERE r.destination_id = d.id);
COMMIT;
SQL
fi

remaining="$("${PLATFORM_COMPOSE[@]}" exec -T postgres psql -U gdc -d gdc -Atc \
  "SELECT COUNT(*) FROM connectors WHERE name IN ('e2e-connector','s3-e2e-connector');" | tr -d '[:space:]')"
echo "Remaining legacy pytest connectors: ${remaining:-0}"
