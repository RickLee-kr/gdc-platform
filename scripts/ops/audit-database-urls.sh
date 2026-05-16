#!/usr/bin/env bash
# Static audit: list DATABASE_URL references and flag risky patterns (read-only).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "=== DATABASE_URL references (repository) ==="
grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
  --exclude-dir=__pycache__ --exclude-dir=.venv \
  -E 'DATABASE_URL|TEST_DATABASE_URL|postgresql://|postgres://' \
  . 2>/dev/null | grep -v 'tools/spec-kit/' | head -120 || true

echo ""
echo "=== alembic stamp usage (destructive if misapplied) ==="
grep -RIn --exclude-dir=node_modules --exclude-dir=.git \
  -E 'alembic stamp' scripts alembic app docs 2>/dev/null || true

echo ""
echo "=== Known orphan revision IDs (documented) ==="
grep -RIn '20260513_0021_dl_parts\|KNOWN_ORPHAN' app docs scripts 2>/dev/null || true

echo ""
echo "=== Compose postgres catalog (POSTGRES_DB) ==="
grep -RIn 'POSTGRES_DB:' docker-compose.platform.yml deploy/docker-compose.https.yml docker-compose.yml 2>/dev/null || true

echo ""
echo "=== Effective .env DATABASE_URL (masked) ==="
if [[ -f .env ]]; then
  url="$(grep -E '^[[:space:]]*DATABASE_URL=' .env | head -n1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
  if [[ -n "$url" ]]; then
    echo "${url//:*@/://***@}"
  else
    echo "(DATABASE_URL not set in .env)"
  fi
else
  echo "(no .env file)"
fi

echo ""
echo "Hints:"
echo "  - docker-compose.platform.yml  -> catalog gdc_test, host port 55432"
echo "  - deploy/docker-compose.https.yml -> catalog gdc (internal only)"
echo "  - Run ./scripts/ops/validate-migrations.sh before upgrade"
