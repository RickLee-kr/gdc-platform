#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
docker compose -f docker-compose.source-expansion-test.yml --project-name gdc_source_expansion_test up -d
echo "Waiting for health..."
for i in $(seq 1 60); do
  if docker compose -f docker-compose.source-expansion-test.yml --project-name gdc_source_expansion_test ps --format json 2>/dev/null | grep -q healthy; then
    break
  fi
  sleep 2
done
echo "Postgres: localhost:55432  user=gdc_fixture db=gdc_source_expansion_pg"
echo "MySQL:    localhost:33306  user=gdc_fixture db=gdc_source_expansion_my"
echo "MariaDB:  localhost:33307  user=gdc_fixture db=gdc_source_expansion_ma"
