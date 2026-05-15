#!/usr/bin/env bash
# Start isolated test dependencies (PostgreSQL, WireMock, webhook echo, syslog listener).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/testing/_env.sh"
cd "$ROOT"
export COMPOSE_PROFILES=test
docker compose -f "$GDC_TEST_COMPOSE_FILE" up -d postgres-test wiremock-test webhook-receiver-test syslog-test
echo "Test stack up."
echo "  TEST_DATABASE_URL=$TEST_DATABASE_URL"
echo "  WIREMOCK_BASE_URL=$WIREMOCK_BASE_URL"
echo "  Webhook echo (optional): http://127.0.0.1:18091"
echo "  Syslog container (optional): 127.0.0.1:15514 tcp/udp"
