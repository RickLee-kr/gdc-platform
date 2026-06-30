#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"

echo "[frontend-redeploy] npm run build"
npm run build

echo "[frontend-redeploy] docker compose build frontend"
docker compose -f "$ROOT/docker-compose.platform.yml" build frontend

echo "[frontend-redeploy] docker compose up frontend"
docker compose -f "$ROOT/docker-compose.platform.yml" up -d --force-recreate frontend

echo "[frontend-redeploy] waiting for frontend health"
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if docker compose -f "$ROOT/docker-compose.platform.yml" ps frontend 2>/dev/null | grep -q healthy; then
    break
  fi
  sleep 3
done

BUNDLE="$(docker compose -f "$ROOT/docker-compose.platform.yml" exec -T frontend sh -c 'ls -1 /usr/share/nginx/html/assets/index-*.js 2>/dev/null | head -1' 2>/dev/null || true)"
MTIME="$(docker compose -f "$ROOT/docker-compose.platform.yml" exec -T frontend sh -c 'stat -c %y /usr/share/nginx/html/assets/index-*.js 2>/dev/null | head -1' 2>/dev/null || true)"
echo "[frontend-redeploy] bundle=${BUNDLE:-unknown} mtime=${MTIME:-unknown}"
echo "[frontend-redeploy] done"
