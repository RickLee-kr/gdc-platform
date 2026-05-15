#!/usr/bin/env bash
# Stop Dev Validation Lab processes; optionally stop Docker test stack (no volume removal).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$ROOT/.dev-validation-logs"
COMPOSE_FILE="$ROOT/docker-compose.dev-validation.yml"
LAB_COMPOSE_PROJECT="${GDC_DEV_VALIDATION_COMPOSE_PROJECT:-gdc-platform-test}"
STOP_DOCKER=false

for arg in "$@"; do
  case "$arg" in
  --with-docker) STOP_DOCKER=true ;;
  -h | --help)
    echo "Usage: $0 [--with-docker]"
    echo "  Stops backend/frontend using PID files under .dev-validation-logs/"
    echo "  --with-docker  also runs: docker compose stop (volumes are preserved)"
    exit 0
    ;;
  *)
    echo "Unknown option: $arg (try --help)" >&2
    exit 1
    ;;
  esac
done

kill_pidfile() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  local pid
  pid="$(tr -d ' \n\r\t' <"$f" | head -c 32)"
  [[ "$pid" =~ ^[0-9]+$ ]] || {
    rm -f "$f"
    return 0
  }
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 40); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
    echo "Stopped PID $pid ($(basename "$f" .pid))"
  else
    echo "Stale PID file (process not running): $f"
  fi
  rm -f "$f"
}

kill_pidfile "$LOG_DIR/backend.pid"
kill_pidfile "$LOG_DIR/frontend.pid"

if [[ "$STOP_DOCKER" == true ]]; then
  echo "Stopping Docker test stack (containers only; volumes kept, project: $LAB_COMPOSE_PROJECT)..."
  docker compose -p "$LAB_COMPOSE_PROJECT" -f "$COMPOSE_FILE" --profile dev-validation stop || true
else
  echo "Docker test stack left running. To stop containers: $0 --with-docker"
fi
