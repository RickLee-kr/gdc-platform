#!/usr/bin/env bash
# Continuous smoke E2E loop for local regression awareness (development infrastructure only).
# Env: E2E_WATCH_INTERVAL_SEC (default 300)
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/testing/_env.sh"
cd "$ROOT"
INTERVAL="${E2E_WATCH_INTERVAL_SEC:-300}"
mkdir -p .test-history/latest .test-history/smoke .test-history/regression .test-history/auth .test-history/delivery .test-history/artifacts/smoke

STATUS_FILE=".test-history/latest/smoke-last-status.txt"
SUCCESS_FILE=".test-history/latest/smoke-last-success.txt"
FAIL_TS_FILE=".test-history/latest/smoke-first-failure-ts.txt"
JUNIT=".test-history/latest/smoke-junit.xml"
LOG_LAST=".test-history/latest/smoke-last.log"

echo "watch-e2e: interval=${INTERVAL}s repo=${ROOT}"
echo "Ctrl+C to stop."

while true; do
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  arch_log=".test-history/smoke/run-${ts}.log"
  if [[ -f "$STATUS_FILE" ]]; then
    prev="$(tr '[:lower:]' '[:upper:]' <"$STATUS_FILE")"
  else
    prev="UNKNOWN"
  fi

  set +e
  python3 -m pytest -m e2e_smoke -v --tb=short -x \
    --junitxml="$JUNIT" \
    tests/test_wiremock_template_e2e.py \
    tests/test_e2e_syslog_delivery.py 2>&1 | tee "$arch_log" | tee "$LOG_LAST"
  rc=${PIPESTATUS[0]}
  set -e

  cp -f "$arch_log" ".test-history/smoke/latest.log" 2>/dev/null || true

  python3 "$ROOT/scripts/testing/py/junit_summary.py" "$JUNIT" --text 2>/dev/null || true
  python3 "$ROOT/scripts/testing/py/junit_summary.py" "$JUNIT" --markdown ".test-history/latest/smoke-summary.md" 2>/dev/null || true
  python3 "$ROOT/scripts/testing/py/flaky_tracker.py" update --junit "$JUNIT" --state ".test-history/flaky-state.json" --summary ".test-history/flaky-summary.txt" 2>/dev/null || true

  mapfile -t _ws < <(python3 "$ROOT/scripts/testing/py/e2e_watch_stats.py" "$JUNIT" "$rc" "$prev" 2>/dev/null || echo -e "FAIL\n1\n0\nstats_error")
  curr="${_ws[0]:-FAIL}"
  failed="${_ws[1]:-1}"
  tests="${_ws[2]:-0}"
  trans="${_ws[3]:-unknown}"

  if [[ "$curr" == "PASS" ]]; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$SUCCESS_FILE"
    rm -f "$FAIL_TS_FILE" 2>/dev/null || true
  else
    if [[ ! -f "$FAIL_TS_FILE" ]]; then
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$FAIL_TS_FILE"
    fi
  fi

  echo "watch-e2e: cycle=$ts exit=$rc failed=$failed tests=$tests note=$trans"
  echo "$curr" >"$STATUS_FILE"

  if [[ "$rc" -ne 0 ]]; then
    art=".test-history/artifacts/smoke/$ts"
    mkdir -p "$art"
    tail -n 200 "$LOG_LAST" >"$art/pytest-tail.txt" 2>/dev/null || true
    docker compose -f "$GDC_TEST_COMPOSE_FILE" logs --no-color --tail=200 postgres-test wiremock-test 2>/dev/null >"$art/compose-tail.txt" || true
  fi

  sleep "$INTERVAL"
done
