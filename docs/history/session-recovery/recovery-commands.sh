#!/usr/bin/env bash
# Post-reboot recovery script for gdc-platform (feature/next-work @ 50e6a7f)
# Usage: bash docs/history/session-recovery/recovery-commands.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "=== Git state ==="
git branch --show-current
git status --short
git log --oneline -5

echo ""
echo "=== Sync remote (optional) ==="
# git pull origin feature/next-work

echo ""
echo "=== Apply patches (only if non-empty) ==="
if [[ -s docs/session-recovery/working-tree.patch ]]; then
  git apply docs/session-recovery/working-tree.patch
  echo "Applied working-tree.patch"
else
  echo "working-tree.patch is empty — skip"
fi
if [[ -s docs/session-recovery/staged.patch ]]; then
  git apply --cached docs/session-recovery/staged.patch
  echo "Applied staged.patch to index"
else
  echo "staged.patch is empty — skip"
fi

echo ""
echo "=== Rebuild and restart API + frontend ==="
docker compose build api frontend
docker compose up -d api frontend
docker compose ps

echo ""
echo "=== Alembic: upgrade to head (production Compose DB) ==="
docker compose exec api alembic upgrade head
docker compose exec api alembic current

echo ""
echo "=== Verify audit_logs migration ==="
docker compose exec postgres psql -U gdc -d gdc -c "SELECT version_num FROM alembic_version;"
docker compose exec postgres psql -U gdc -d gdc -c "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'audit_logs');"

echo ""
echo "=== Backend pytest (audit logs) ==="
python3 -m pytest tests/test_audit_logs.py -q

echo ""
echo "=== Frontend build + targeted vitest ==="
cd frontend
npm run build
npm test -- --run runtime-topology audit-logs pipeline-debugger
cd "$ROOT"

echo ""
echo "=== Optional: full compose restart ==="
# docker compose restart

echo ""
echo "=== Optional: smoke URLs (adjust auth as needed) ==="
# curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/health
# curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer <token>" http://127.0.0.1:8000/api/v1/runtime/topology
# curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer <token>" http://127.0.0.1:8000/api/v1/audit-logs/

echo ""
echo "Recovery script finished."
