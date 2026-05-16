#!/usr/bin/env bash
# Dev Validation Lab — production separation verification.
#
# Static + runtime proof that the lab cannot leak into production:
#   1. app.config defaults keep the lab off out of the box.
#   2. docker-compose.yml (the production stack) does not define ENABLE_DEV_VALIDATION_LAB
#      and does not run WireMock / webhook-echo / syslog-test by default.
#   3. docker-compose.test.yml gates every test receiver behind a profile.
#   4. Runtime: pytest in tests/test_dev_validation_lab_production_safety.py
#      proves run_dev_validation_lab_startup() and seed_dev_validation_lab()
#      refuse APP_ENV=production even with ENABLE_DEV_VALIDATION_LAB=true
#      and DEV_VALIDATION_AUTO_START=true.
#   5. reset-db.sh refuses non-test DATABASE_URL strings.
#   6. start.sh safety gate (see scripts/dev-validation/start-dev-validation-lab.sh)
#      refuses to start unless DATABASE_URL is the isolated lab test DB AND
#      APP_ENV is not production.
#
# Read-only, idempotent, and safe to run on any developer machine. Set
# SKIP_PYTEST=1 to skip the pytest invocation (e.g. when no test stack is up).
#
# Exit codes:
#   0 — all checks passed
#   non-zero — at least one safety gap detected (details printed)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESET_DB="$ROOT/scripts/validation-lab/reset-db.sh"
START_DEV="$ROOT/scripts/dev-validation/start-dev-validation-lab.sh"
PROD_COMPOSE="$ROOT/docker-compose.yml"
TEST_COMPOSE="$ROOT/docker-compose.test.yml"
SAFETY_PYTEST="tests/test_dev_validation_lab_production_safety.py"

PASS=0
FAIL=0
WARN=0

step() {
  echo ""
  echo "=============================================================="
  echo "  $1"
  echo "=============================================================="
}

ok() {
  PASS=$((PASS + 1))
  echo "  [ OK ]  $1"
}

bad() {
  FAIL=$((FAIL + 1))
  echo "  [FAIL]  $1" >&2
}

warn() {
  WARN=$((WARN + 1))
  echo "  [WARN]  $1"
}

contains() {
  grep -Fq -- "$2" "$1" 2>/dev/null
}

step "1) app.config defaults — lab off out of the box, APP_ENV not production"
if [[ -f "$ROOT/app/config.py" ]]; then
  if grep -Eq '^\s*ENABLE_DEV_VALIDATION_LAB:\s*bool\s*=\s*False\b' "$ROOT/app/config.py"; then
    ok "ENABLE_DEV_VALIDATION_LAB default is False"
  else
    bad "ENABLE_DEV_VALIDATION_LAB default is NOT False in app/config.py"
  fi
  if grep -Eq '^\s*DEV_VALIDATION_AUTO_START:\s*bool\s*=\s*False\b' "$ROOT/app/config.py"; then
    ok "DEV_VALIDATION_AUTO_START default is False"
  else
    bad "DEV_VALIDATION_AUTO_START default is NOT False in app/config.py"
  fi
  for flag in ENABLE_DEV_VALIDATION_S3 ENABLE_DEV_VALIDATION_DATABASE_QUERY ENABLE_DEV_VALIDATION_REMOTE_FILE ENABLE_DEV_VALIDATION_PERFORMANCE; do
    if grep -Eq "^[[:space:]]*${flag}:[[:space:]]*bool[[:space:]]*=[[:space:]]*False\\b" "$ROOT/app/config.py"; then
      ok "${flag} default is False"
    else
      bad "${flag} default is NOT False in app/config.py"
    fi
  done
  if grep -Eq '^\s*APP_ENV:\s*str\s*=\s*"(?!production|prod)' "$ROOT/app/config.py"; then
    ok "APP_ENV default is not production/prod"
  elif grep -Eq '^\s*APP_ENV:\s*str\s*=\s*"[^"]*"' "$ROOT/app/config.py"; then
    DEF=$(grep -oE 'APP_ENV:\s*str\s*=\s*"[^"]*"' "$ROOT/app/config.py" | head -n1 | sed -E 's/.*"([^"]*)".*/\1/')
    if [[ "$(echo "$DEF" | tr '[:upper:]' '[:lower:]')" =~ ^(production|prod)$ ]]; then
      bad "APP_ENV default is production-like: $DEF"
    else
      ok "APP_ENV default is '$DEF' (non-production)"
    fi
  else
    warn "Could not introspect APP_ENV default in app/config.py"
  fi
else
  bad "app/config.py missing"
fi

step "2) Production compose (docker-compose.yml) — no lab knobs, no default test receivers"
if [[ ! -f "$PROD_COMPOSE" ]]; then
  bad "missing $PROD_COMPOSE"
else
  if contains "$PROD_COMPOSE" "ENABLE_DEV_VALIDATION_LAB"; then
    bad "docker-compose.yml mentions ENABLE_DEV_VALIDATION_LAB (must not enable lab in prod)"
  else
    ok "docker-compose.yml does not reference ENABLE_DEV_VALIDATION_LAB"
  fi
  if contains "$PROD_COMPOSE" "DEV_VALIDATION_AUTO_START"; then
    bad "docker-compose.yml mentions DEV_VALIDATION_AUTO_START"
  else
    ok "docker-compose.yml does not reference DEV_VALIDATION_AUTO_START"
  fi

  # WireMock may exist as a service in docker-compose.yml but only under the
  # 'test' profile (so `docker compose up` without --profile test never runs it).
  if grep -Eq '^\s*wiremock:' "$PROD_COMPOSE"; then
    # Service exists — ensure it is profile-gated.
    if awk '
      /^\s*wiremock:/ {in_block=1; next}
      in_block && /^[a-zA-Z]/ {in_block=0}
      in_block {print}
    ' "$PROD_COMPOSE" | grep -Eq '^\s*profiles:\s*'; then
      ok "wiremock service in docker-compose.yml is profile-gated"
    else
      bad "wiremock service in docker-compose.yml is NOT profile-gated"
    fi
  else
    ok "wiremock service is not part of docker-compose.yml"
  fi

  for svc in webhook-receiver webhook-receiver-test syslog-test; do
    if grep -Eq "^\s*${svc}:" "$PROD_COMPOSE"; then
      bad "test receiver '${svc}' present in docker-compose.yml"
    else
      ok "test receiver '${svc}' is NOT in docker-compose.yml"
    fi
  done
fi

step "3) Test compose (docker-compose.test.yml) — all test receivers behind profiles"
if [[ ! -f "$TEST_COMPOSE" ]]; then
  warn "missing $TEST_COMPOSE (optional)"
else
  for svc in postgres-test wiremock-test webhook-receiver-test syslog-test; do
    block=$(awk -v s="$svc" '
      $0 ~ "^[[:space:]]*"s":[[:space:]]*$" {in_block=1; next}
      in_block && /^[a-zA-Z]/ {in_block=0}
      in_block {print}
    ' "$TEST_COMPOSE")
    if [[ -z "$block" ]]; then
      warn "service '$svc' not found in docker-compose.test.yml"
      continue
    fi
    if echo "$block" | grep -Eq '^\s*profiles:\s*'; then
      ok "service '$svc' is profile-gated in docker-compose.test.yml"
    else
      bad "service '$svc' is NOT profile-gated in docker-compose.test.yml"
    fi
  done
fi

step "4) reset-db.sh — refuses non-datarelay DATABASE_URL"
if [[ ! -x "$RESET_DB" ]]; then
  bad "reset-db.sh not executable at $RESET_DB"
else
  TMP_OUT="$(mktemp)"
  trap 'rm -f "$TMP_OUT"' EXIT
  # Production-looking URL; reset must refuse BEFORE prompting for confirmation.
  if DATABASE_URL="postgresql://produser:prodpass@prod-db.internal.example.com:5432/prod_main" \
    "$RESET_DB" </dev/null >"$TMP_OUT" 2>&1; then
    bad "reset-db.sh did NOT refuse a production-looking DATABASE_URL"
    sed 's/^/         /' "$TMP_OUT"
  else
    if grep -qE 'database name must be exactly .?datarelay.?' "$TMP_OUT" \
      || grep -qE "ERROR: database name must" "$TMP_OUT"; then
      ok "reset-db.sh refused prod-like DATABASE_URL (db name guard)"
    else
      ok "reset-db.sh refused prod-like DATABASE_URL (non-zero exit)"
    fi
  fi

  : >"$TMP_OUT"
  # Wrong port / wrong host.
  if DATABASE_URL="postgresql://gdc:gdc@10.0.0.5:5432/datarelay" \
    "$RESET_DB" </dev/null >"$TMP_OUT" 2>&1; then
    bad "reset-db.sh did NOT refuse a non-loopback host"
    sed 's/^/         /' "$TMP_OUT"
  else
    ok "reset-db.sh refused non-loopback host (datarelay on remote)"
  fi
  rm -f "$TMP_OUT"
  trap - EXIT
fi

step "5) start-dev-validation-lab.sh — DATABASE_URL + APP_ENV safety gate"
if [[ ! -f "$START_DEV" ]]; then
  bad "missing $START_DEV"
else
  if grep -Fq 'Dev Validation Lab safety gate refused to start' "$START_DEV"; then
    ok "start-dev-validation-lab.sh contains a hard safety gate"
  else
    bad "start-dev-validation-lab.sh is missing the DATABASE_URL/APP_ENV safety gate"
  fi

  # Extract just the safety gate heredoc and exercise it standalone, without
  # touching Docker/uvicorn/Vite. The gate is `python3 - <<'PY' ... PY`.
  GATE="$(awk '/^python3 - <<.PY.[[:space:]]*\|\|/{flag=1; next}
                flag && /^PY[[:space:]]*$/{flag=0}
                flag {print}' "$START_DEV")"

  if [[ -z "$GATE" ]]; then
    warn "could not extract the safety gate script for standalone testing"
  else
    TMP_GATE="$(mktemp --suffix=.py)"
    printf '%s\n' "$GATE" >"$TMP_GATE"
    trap 'rm -f "$TMP_GATE"' EXIT

    # (a) prod-looking DATABASE_URL must be refused
    OUT="$(DATABASE_URL="postgresql://prod:prod@prod-db.example.com:5432/prod_main" APP_ENV="" \
      python3 "$TMP_GATE" 2>&1)"
    if [[ $? -ne 0 ]] && echo "$OUT" | grep -q "safety gate"; then
      ok "safety gate refused prod-looking DATABASE_URL"
    else
      bad "safety gate did NOT refuse prod-looking DATABASE_URL: $OUT"
    fi

    # (b) test DB but APP_ENV=production must still be refused
    OUT="$(DATABASE_URL="postgresql://gdc:gdc@127.0.0.1:55432/datarelay" APP_ENV="production" \
      python3 "$TMP_GATE" 2>&1)"
    if [[ $? -ne 0 ]] && echo "$OUT" | grep -q "APP_ENV"; then
      ok "safety gate refused APP_ENV=production even with test DB"
    else
      bad "safety gate did NOT refuse APP_ENV=production: $OUT"
    fi

    # (c) full test profile must pass
    OUT="$(DATABASE_URL="postgresql://gdc:gdc@127.0.0.1:55432/datarelay" APP_ENV="development" \
      python3 "$TMP_GATE" 2>&1)"
    if [[ $? -eq 0 ]] && echo "$OUT" | grep -q "Safety gate OK"; then
      ok "safety gate accepted the isolated test profile"
    else
      bad "safety gate rejected the isolated test profile: $OUT"
    fi

    rm -f "$TMP_GATE"
    trap - EXIT
  fi
fi

step "6) Runtime tests — production refusal end-to-end"
if [[ "${SKIP_PYTEST:-0}" == "1" ]]; then
  warn "SKIP_PYTEST=1 — skipping pytest (set SKIP_PYTEST=0 to run)"
else
  PY="${GDC_PYTHON:-}"
  if [[ -z "$PY" ]]; then
    if [[ -x "$ROOT/.venv/bin/python" ]]; then
      PY="$ROOT/.venv/bin/python"
    elif command -v python3 >/dev/null 2>&1; then
      PY="$(command -v python3)"
    fi
  fi
  if [[ -z "$PY" ]]; then
    warn "no python3 / .venv found, skipping pytest"
  else
    if [[ -f "$ROOT/scripts/testing/_env.sh" ]]; then
      # shellcheck disable=SC1091
      source "$ROOT/scripts/testing/_env.sh"
    fi
    (cd "$ROOT" && "$PY" -m pytest "$SAFETY_PYTEST" -q) && ok "pytest $SAFETY_PYTEST passed" || bad "pytest $SAFETY_PYTEST FAILED"
  fi
fi

echo ""
echo "=============================================================="
echo "  Summary: PASS=$PASS  WARN=$WARN  FAIL=$FAIL"
echo "=============================================================="
if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0
