#!/usr/bin/env bash
# Collect platform soak metrics at fixed intervals for long-running stability validation.
# Usage:
#   ./scripts/ops/collect-soak-metrics.sh --duration 24h --interval 15m
#   ./scripts/ops/collect-soak-metrics.sh --duration 1h --interval 1m --output /tmp/soak.csv
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="${GDC_RELEASE_COMPOSE_FILE:-$ROOT/docker-compose.platform.yml}"

DURATION="24h"
INTERVAL="15m"
OUTPUT=""

usage() {
  echo "Usage: $0 [--duration 24h|6h|1h] [--interval 15m|5m|1m] [--output path.csv]" >&2
  exit 1
}

parse_duration_seconds() {
  local raw="${1,,}"
  case "$raw" in
    *h) echo $(( ${raw%h} * 3600 )) ;;
    *m) echo $(( ${raw%m} * 60 )) ;;
    *s) echo $(( ${raw%s} )) ;;
    *) echo "$raw" ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --duration) DURATION="$2"; shift 2 ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown arg: $1" >&2; usage ;;
  esac
done

DURATION_SEC="$(parse_duration_seconds "$DURATION")"
INTERVAL_SEC="$(parse_duration_seconds "$INTERVAL")"

if [[ -z "$OUTPUT" ]]; then
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  OUTPUT="$ROOT/docs/release/artifacts/soak-metrics-${ts}.csv"
fi
mkdir -p "$(dirname "$OUTPUT")"

echo "timestamp_utc,api_mem_mib,api_pids,postgres_mem_mib,postgres_pids,pg_connections" > "$OUTPUT"

deadline=$(( $(date +%s) + DURATION_SEC ))
echo "Soak collection started: duration=${DURATION} interval=${INTERVAL} output=${OUTPUT}" >&2

while [[ $(date +%s) -lt $deadline ]]; do
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  api_stats="$(docker stats --no-stream --format '{{.MemUsage}}|{{.PIDs}}' gdc-platform-api 2>/dev/null || echo 'n/a|0')"
  pg_stats="$(docker stats --no-stream --format '{{.MemUsage}}|{{.PIDs}}' gdc-platform-postgres 2>/dev/null || echo 'n/a|0')"
  api_mem="$(echo "$api_stats" | cut -d'|' -f1 | awk -F/ '{print $1}' | tr -d ' MiBGiB')"
  api_pids="$(echo "$api_stats" | cut -d'|' -f2)"
  pg_mem="$(echo "$pg_stats" | cut -d'|' -f1 | awk -F/ '{print $1}' | tr -d ' MiBGiB')"
  pg_pids="$(echo "$pg_stats" | cut -d'|' -f2)"
  pg_conn="$(docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U gdc -d gdc -tAc \
    "SELECT count(*) FROM pg_stat_activity WHERE datname='gdc';" 2>/dev/null | tr -d ' ' || echo 0)"
  echo "${ts},${api_mem},${api_pids},${pg_mem},${pg_pids},${pg_conn}" >> "$OUTPUT"
  echo "[${ts}] api_mem=${api_mem}MiB api_pids=${api_pids} pg_conn=${pg_conn}" >&2
  sleep "$INTERVAL_SEC"
done

echo "Soak collection complete: ${OUTPUT}" >&2
