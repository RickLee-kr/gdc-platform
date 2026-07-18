#!/usr/bin/env bash
# Test-only fault injection for Full E2E Lab fixtures / host API.
# Never targets production compose services.
#
# Usage:
#   ./e2e/lab/fault-inject.sh start <target>
#   ./e2e/lab/fault-inject.sh stop <target>
#   ./e2e/lab/fault-inject.sh reset
#   ./e2e/lab/fault-inject.sh status <target>
#
# Targets: database | s3 | sftp | api | runtime | webhook | syslog | syslog-tls

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAB_DIR="$ROOT/e2e/lab"
COMPOSE_FILE="$LAB_DIR/docker-compose.full-e2e.yml"
ENV_FILE="${GDC_E2E_ENV_FILE:-$LAB_DIR/.env.route-off}"
PID_DIR="$ROOT/e2e/reports/.pids"
LOG_DIR="$ROOT/e2e/reports/lab-logs"
STATE_DIR="$ROOT/e2e/reports/.fault-state"
PREFIX="${GDC_TEST_CONTAINER_PREFIX:-gdc}"

ACTION="${1:-}"
TARGET="${2:-}"

mkdir -p "$STATE_DIR" "$LOG_DIR" "$PID_DIR"

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

container_for() {
  case "$1" in
    database) echo "${PREFIX}-postgres-query-test" ;;
    s3) echo "${PREFIX}-minio-test" ;;
    sftp) echo "${PREFIX}-sftp-test" ;;
    webhook) echo "${PREFIX}-webhook-collector" ;;
    syslog|syslog-tls) echo "${PREFIX}-syslog-collector" ;;
    *) return 1 ;;
  esac
}

compose_service_for() {
  case "$1" in
    database) echo "postgres-query-test" ;;
    s3) echo "minio-test" ;;
    sftp) echo "sftp-test" ;;
    webhook) echo "webhook-collector" ;;
    syslog|syslog-tls) echo "syslog-collector" ;;
    *) return 1 ;;
  esac
}

wait_http() {
  local url="$1" name="$2" tries="${3:-60}"
  for _ in $(seq 1 "$tries"); do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo "    OK $name"
      return 0
    fi
    sleep 1
  done
  echo "ERROR: timeout waiting for $name at $url" >&2
  return 1
}

api_port() {
  echo "${GDC_E2E_API_PORT:-18000}"
}

start_api() {
  local port
  port="$(api_port)"
  if [[ -f "$PID_DIR/api.pid" ]] && kill -0 "$(cat "$PID_DIR/api.pid")" 2>/dev/null; then
    echo "    API already running pid=$(cat "$PID_DIR/api.pid")"
    return 0
  fi
  (
    cd "$ROOT"
    # shellcheck disable=SC1090
    set -a
    # Load lab env so restart matches original route flag
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
      if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
        key="${BASH_REMATCH[1]}"
        val="${BASH_REMATCH[2]}"
        if [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
        if [[ "$val" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}"; fi
        export "$key=$val"
      fi
    done <"$ENV_FILE"
    set +a
    export PYTHONPATH="$ROOT${PYTHONPATH:+:$PYTHONPATH}"
    nohup python3 -m uvicorn app.main:app \
      --host 127.0.0.1 --port "$port" \
      >"$LOG_DIR/api_fault_restart.log" 2>&1 &
    echo $! >"$PID_DIR/api.pid"
  )
  wait_http "http://127.0.0.1:$port/health" "API" 60
}

stop_api() {
  if [[ -f "$PID_DIR/api.pid" ]]; then
    kill "$(cat "$PID_DIR/api.pid")" 2>/dev/null || true
    rm -f "$PID_DIR/api.pid"
    sleep 1
  fi
  # Also kill any leftover lab API on the dedicated port
  local port
  port="$(api_port)"
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "${pids:-}" ]]; then
      # shellcheck disable=SC2086
      kill $pids 2>/dev/null || true
    fi
  fi
}

fault_start() {
  local t="$1"
  echo "==> [fault start] $t"
  case "$t" in
    database|s3|sftp|webhook|syslog)
      local svc cname
      svc="$(compose_service_for "$t")"
      cname="$(container_for "$t")"
      # Prefer docker stop by stable container_name — fixtures may belong to
      # another compose project that shares GDC_TEST_CONTAINER_PREFIX.
      if docker inspect "$cname" >/dev/null 2>&1; then
        docker stop "$cname" >/dev/null
      else
        compose stop "$svc" || true
      fi
      echo "$t" >"$STATE_DIR/${t}.active"
      ;;
    syslog-tls)
      local cname
      cname="$(container_for syslog-tls)"
      if docker inspect "$cname" >/dev/null 2>&1; then
        docker stop "$cname" >/dev/null
      else
        compose stop syslog-collector || true
      fi
      echo "syslog-tls" >"$STATE_DIR/syslog-tls.active"
      echo '{"mode":"collector_down"}' >"$STATE_DIR/syslog-tls.json"
      ;;
    api|runtime)
      stop_api
      echo "$t" >"$STATE_DIR/${t}.active"
      ;;
    *)
      echo "Unknown fault target: $t" >&2
      echo "Supported: database s3 sftp api runtime webhook syslog syslog-tls" >&2
      exit 2
      ;;
  esac
  echo "    injected"
}

fault_stop() {
  local t="$1"
  echo "==> [fault stop] $t (recover)"
  case "$t" in
    database|s3|sftp|webhook|syslog)
      local svc cname
      svc="$(compose_service_for "$t")"
      cname="$(container_for "$t")"
      if docker inspect "$cname" >/dev/null 2>&1; then
        docker start "$cname" >/dev/null
      else
        compose start "$svc" || true
      fi
      rm -f "$STATE_DIR/${t}.active"
      case "$t" in
        webhook)
          wait_http "${GDC_E2E_WEBHOOK_COLLECTOR_URL:-http://127.0.0.1:18192}/health" "Webhook collector" 40
          ;;
        syslog)
          wait_http "${GDC_E2E_SYSLOG_COLLECTOR_API_URL:-http://127.0.0.1:18193}/health" "Syslog collector" 40
          ;;
        database)
          for _ in $(seq 1 40); do
            if docker exec "$cname" pg_isready -U gdc_fixture >/dev/null 2>&1; then break; fi
            sleep 1
          done
          ;;
        s3)
          for _ in $(seq 1 40); do
            if curl -sf "${SOURCE_E2E_MINIO_ENDPOINT:-http://127.0.0.1:59000}/minio/health/live" >/dev/null 2>&1; then break; fi
            sleep 1
          done
          ;;
        sftp)
          sleep 3
          ;;
      esac
      ;;
    syslog-tls)
      local cname
      cname="$(container_for syslog-tls)"
      if docker inspect "$cname" >/dev/null 2>&1; then
        docker start "$cname" >/dev/null
      else
        compose start syslog-collector || true
      fi
      wait_http "${GDC_E2E_SYSLOG_COLLECTOR_API_URL:-http://127.0.0.1:18193}/health" "Syslog collector" 40
      rm -f "$STATE_DIR/syslog-tls.active" "$STATE_DIR/syslog-tls.json"
      ;;
    api|runtime)
      start_api
      rm -f "$STATE_DIR/${t}.active"
      ;;
    *)
      echo "Unknown fault target: $t" >&2
      exit 2
      ;;
  esac
  echo "    recovered"
}

fault_status() {
  local t="$1"
  if [[ -f "$STATE_DIR/${t}.active" ]]; then
    echo "active"
    return 0
  fi
  echo "inactive"
}

fault_reset() {
  echo "==> [fault reset] recovering all injected faults"
  for t in database s3 sftp webhook syslog syslog-tls api runtime; do
    if [[ -f "$STATE_DIR/${t}.active" ]]; then
      fault_stop "$t" || true
    fi
  done
  # Ensure fixtures are up even if state files were lost
  for t in database s3 sftp webhook syslog; do
    cname="$(container_for "$t" 2>/dev/null || true)"
    [[ -n "${cname:-}" ]] || continue
    if docker inspect "$cname" >/dev/null 2>&1; then
      docker start "$cname" >/dev/null 2>&1 || true
    fi
  done
  compose start postgres-query-test minio-test sftp-test webhook-collector syslog-collector 2>/dev/null || true
  start_api || true
  rm -f "$STATE_DIR"/*.active "$STATE_DIR"/*.json 2>/dev/null || true
  echo "==> [fault reset] done"
}

case "$ACTION" in
  start)
    [[ -n "$TARGET" ]] || { echo "Usage: $0 start <target>" >&2; exit 2; }
    fault_start "$TARGET"
    ;;
  stop)
    [[ -n "$TARGET" ]] || { echo "Usage: $0 stop <target>" >&2; exit 2; }
    fault_stop "$TARGET"
    ;;
  reset)
    fault_reset
    ;;
  status)
    [[ -n "$TARGET" ]] || { echo "Usage: $0 status <target>" >&2; exit 2; }
    fault_status "$TARGET"
    ;;
  *)
    cat <<EOF
Usage: $0 {start|stop|reset|status} [target]
Targets: database s3 sftp api runtime webhook syslog syslog-tls
EOF
    exit 2
    ;;
esac
