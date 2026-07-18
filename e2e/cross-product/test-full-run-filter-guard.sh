#!/usr/bin/env bash
# Verify run-all-shards.sh fails when GDC_XP_COMBINATION_IDS / GDC_XP_LIMIT are set.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/e2e/cross-product/run-all-shards.sh"
PASS=0
FAIL=0

assert_fails() {
  local label="$1"
  shift
  set +e
  out="$(env "$@" bash "$SCRIPT" 2>&1)"
  rc=$?
  set -e
  if [[ $rc -eq 1 ]] && echo "$out" | grep -q 'refuses residual filters'; then
    echo "PASS: $label"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $label (rc=$rc)"
    echo "$out" | head -20
    FAIL=$((FAIL + 1))
  fi
}

# Do not actually run shards — only reach the filter guard.
# Patch PATH so a mistaken fall-through cannot invoke real playwright.
export PATH="/usr/bin:/bin"
export GDC_E2E_RUN_ID="xp_guard_test_$$"

assert_fails "COMBINATION_IDS residual" GDC_XP_COMBINATION_IDS=xp_deadbeef
assert_fails "LIMIT residual" GDC_XP_LIMIT=5
assert_fails "both residual" GDC_XP_COMBINATION_IDS=xp_a GDC_XP_LIMIT=1

# Clean env must pass the guard (may fail later on missing shard-plan / playwright — that is OK).
set +e
clean_out="$(env -u GDC_XP_COMBINATION_IDS -u GDC_XP_LIMIT \
  GDC_E2E_RUN_ID="xp_guard_clean_$$" \
  GDC_XP_SHARD_FILTER="__no_such_shard__" \
  bash "$SCRIPT" 2>&1)"
clean_rc=$?
set -e
if echo "$clean_out" | grep -q 'refuses residual filters'; then
  echo "FAIL: clean env incorrectly rejected by filter guard"
  FAIL=$((FAIL + 1))
elif echo "$clean_out" | grep -qE 'RUN_ID=|shards=0|Unknown|DONE|ERROR'; then
  echo "PASS: clean env passed filter guard (downstream rc=$clean_rc)"
  PASS=$((PASS + 1))
else
  echo "FAIL: clean env unexpected output"
  echo "$clean_out" | head -30
  FAIL=$((FAIL + 1))
fi

echo "guard-tests pass=$PASS fail=$FAIL"
[[ $FAIL -eq 0 ]]
