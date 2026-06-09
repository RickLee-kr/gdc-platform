#!/usr/bin/env bash
# RH-02: EXPLAIN ANALYZE for operational snapshot last-outcome query over delivery_logs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="${GDC_RELEASE_COMPOSE_FILE:-$ROOT/docker-compose.platform.yml}"

GROUP_COLUMN="${1:-stream_id}"

echo "=== delivery_logs row count ==="
docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U gdc -d gdc -c \
  "SELECT count(*) AS total_rows, count(DISTINCT ${GROUP_COLUMN}) AS distinct_groups FROM delivery_logs WHERE ${GROUP_COLUMN} IS NOT NULL;"

echo "=== indexes on delivery_logs ==="
docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U gdc -d gdc -c \
  "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'delivery_logs' ORDER BY indexname;"

echo "=== EXPLAIN ANALYZE (last outcomes, group_by=${GROUP_COLUMN}) ==="
docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U gdc -d gdc <<SQL
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
WITH scoped AS (
    SELECT
        delivery_logs.${GROUP_COLUMN} AS group_id,
        delivery_logs.created_at,
        delivery_logs.stage,
        delivery_logs.message
    FROM delivery_logs
    WHERE delivery_logs.${GROUP_COLUMN} IS NOT NULL
      AND delivery_logs.stage = ANY(ARRAY[
          'route_send_success','route_send_failed','route_retry_success','route_retry_failed',
          'run_complete','run_failed'
      ])
      AND UPPER(COALESCE(delivery_logs.level, '')) <> 'DEBUG'
),
success_ts AS (
    SELECT group_id, MAX(created_at) AS last_success_at
    FROM scoped
    WHERE stage = ANY(ARRAY['route_send_success','route_retry_success','run_complete'])
    GROUP BY group_id
),
failure_ts AS (
    SELECT group_id, MAX(created_at) AS last_failure_at
    FROM scoped
    WHERE stage = ANY(ARRAY['route_send_failed','route_retry_failed','run_failed'])
    GROUP BY group_id
),
latest_failure AS (
    SELECT DISTINCT ON (group_id)
        group_id,
        message AS last_error_message
    FROM scoped
    WHERE stage = ANY(ARRAY['route_send_failed','route_retry_failed','run_failed'])
    ORDER BY group_id ASC, created_at DESC
)
SELECT
    COALESCE(s.group_id, f.group_id, lf.group_id) AS group_id,
    s.last_success_at,
    f.last_failure_at,
    lf.last_error_message
FROM success_ts s
FULL OUTER JOIN failure_ts f ON f.group_id = s.group_id
FULL OUTER JOIN latest_failure lf
    ON lf.group_id = COALESCE(s.group_id, f.group_id);
SQL
