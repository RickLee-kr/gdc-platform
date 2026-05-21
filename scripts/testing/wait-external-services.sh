#!/usr/bin/env bash
# Poll loopback readiness for external runtime E2E fixtures (no arbitrary long sleeps).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/testing/_env.sh"

WIREMOCK="${WIREMOCK_BASE_URL:-http://127.0.0.1:28080}"
MINIO_HOST="${SOURCE_E2E_MINIO_HOST:-127.0.0.1}"
MINIO_PORT="${SOURCE_E2E_MINIO_PORT:-59000}"
PG_PORT="${SOURCE_E2E_PG_FIXTURE_PORT:-55433}"
SFTP_HOST="${SOURCE_E2E_SFTP_HOST:-127.0.0.1}"
SFTP_PORT="${SOURCE_E2E_SFTP_PORT:-22222}"
POSTGRES_PORT="${GDC_TEST_POSTGRES_HOST_PORT:-55441}"
TIMEOUT="${E2E_WAIT_TIMEOUT_SEC:-90}"

_wait_tcp() {
  local label="$1" host="$2" port="$3"
  echo "Waiting for $label ($host:$port) …"
  for _ in $(seq 1 "$TIMEOUT"); do
    if python3 -c "import socket; s=socket.socket(); s.settimeout(0.5); s.connect(('$host', int('$port'))); s.close()" 2>/dev/null; then
      echo "  OK: $label"
      return 0
    fi
    sleep 1
  done
  echo "ERROR: $label not reachable on $host:$port within ${TIMEOUT}s" >&2
  return 1
}

_wait_http() {
  local label="$1" url="$2"
  echo "Waiting for $label ($url) …"
  for _ in $(seq 1 "$TIMEOUT"); do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo "  OK: $label"
      return 0
    fi
    sleep 1
  done
  echo "ERROR: $label not reachable at $url within ${TIMEOUT}s" >&2
  return 1
}

_wait_tcp "postgres-test" "127.0.0.1" "$POSTGRES_PORT"
_wait_http "WireMock" "$WIREMOCK/__admin/mappings"
_wait_tcp "MinIO API" "$MINIO_HOST" "$MINIO_PORT"
_wait_tcp "postgres-query-test" "127.0.0.1" "$PG_PORT"
_wait_tcp "sftp-test" "$SFTP_HOST" "$SFTP_PORT"
echo "External service readiness: OK"
