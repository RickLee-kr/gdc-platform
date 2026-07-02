#!/usr/bin/env bash
# Print PostgreSQL top 10 statements by total execution time (pg_stat_statements).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

POSTGRES_CONTAINER="${GDC_POSTGRES_CONTAINER:-gdc-platform-postgres}"
POSTGRES_DB="${POSTGRES_DB:-gdc}"
POSTGRES_USER="${POSTGRES_USER:-gdc}"

docker exec -i "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<'SQL'
SELECT
  LEFT(query, 120) AS query_preview,
  calls,
  ROUND(total_exec_time::numeric, 2) AS total_ms,
  ROUND(mean_exec_time::numeric, 2) AS mean_ms,
  ROUND(max_exec_time::numeric, 2) AS max_ms,
  rows
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY total_exec_time DESC
LIMIT 10;
SQL
