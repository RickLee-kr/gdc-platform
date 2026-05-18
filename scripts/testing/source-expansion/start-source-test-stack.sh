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
echo "Postgres: localhost:${GDC_SOURCE_EXPANSION_PG_HOST_PORT:-55434}  user=gdc_fixture db=gdc_source_expansion_pg"
echo "MySQL:    localhost:${GDC_SOURCE_EXPANSION_MYSQL_HOST_PORT:-33308}  user=gdc_fixture db=gdc_source_expansion_my"
echo "MariaDB:  localhost:${GDC_SOURCE_EXPANSION_MARIADB_HOST_PORT:-33309}  user=gdc_fixture db=gdc_source_expansion_ma"
