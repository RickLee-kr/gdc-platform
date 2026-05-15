#!/usr/bin/env bash
# Safety checks for reset-dev-validation-db.sh (no DB mutations).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
R="$ROOT/scripts/dev-validation/reset-dev-validation-db.sh"

expect_fail() {
  local msg="$1"
  shift
  set +e
  "$@"
  local ec=$?
  set -e
  if [[ $ec -eq 0 ]]; then
    echo "FAIL: expected non-zero exit: $msg" >&2
    exit 1
  fi
  echo "ok: $msg (exit $ec)"
}

bash -n "$R"

# Wrong database name
expect_fail "wrong database name" env DATABASE_URL="postgresql://gdc:gdc@127.0.0.1:55432/other_db" bash "$R"

# Wrong port
expect_fail "wrong port" env DATABASE_URL="postgresql://gdc:gdc@127.0.0.1:5432/gdc_test" bash "$R"

# Wrong host
expect_fail "wrong host" env DATABASE_URL="postgresql://gdc:gdc@10.0.0.5:55432/gdc_test" bash "$R"

# Wrong user
expect_fail "wrong user" env DATABASE_URL="postgresql://postgres:gdc@127.0.0.1:55432/gdc_test" bash "$R"

# Right URL but wrong confirmation
TSTURL="postgresql://gdc:gdc@127.0.0.1:55432/gdc_test"
expect_fail "wrong confirmation phrase" bash -c "printf '%s\n' NO | DATABASE_URL='$TSTURL' bash '$R'"

echo ""
echo "All reset-dev-validation-db.sh safety tests passed."
