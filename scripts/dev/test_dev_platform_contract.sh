#!/usr/bin/env bash
# Static contract checks for dev bootstrap/validate scripts (no Docker required).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }

for script in \
  "$ROOT/scripts/dev/bootstrap-dev-platform.sh" \
  "$ROOT/scripts/dev/validate-platform-ready.sh" \
  "$ROOT/scripts/dev/start-platform.sh" \
  "$ROOT/scripts/admin/reset-admin-password.sh" \
  "$ROOT/scripts/testing/start-test-stack.sh"; do
  [[ -f "$script" ]] || fail "missing $script"
  bash -n "$script" || fail "syntax error in $script"
  ok "bash -n $(basename "$script")"
done

grep -q '55432' "$ROOT/scripts/dev/bootstrap-dev-platform.sh" \
  || fail "bootstrap must reference platform port 55432"
grep -q 'start-test-stack.sh' "$ROOT/scripts/dev/bootstrap-dev-platform.sh" \
  || fail "bootstrap must start pytest stack"
grep -q 'GDC_VALIDATE_ADMIN_PASSWORD' "$ROOT/scripts/dev/validate-platform-ready.sh" \
  || fail "validate must support GDC_VALIDATE_ADMIN_PASSWORD"
grep -q 'credential drift' "$ROOT/scripts/dev/validate-platform-ready.sh" \
  || fail "validate must warn on credential drift"
grep -q 'admin platform user is missing' "$ROOT/scripts/dev/validate-platform-ready.sh" \
  || fail "validate must hard-fail missing admin"
grep -q '55440' "$ROOT/scripts/testing/start-test-stack.sh" \
  || fail "start-test-stack must verify 55440"
grep -q 'gdc_pytest' "$ROOT/scripts/testing/start-test-stack.sh" \
  || fail "start-test-stack must verify gdc_pytest on 55441"
grep -q '\-\-password' "$ROOT/scripts/admin/reset-admin-password.sh" \
  || fail "reset-admin-password must accept --password"
grep -q 'bootstrap-dev-platform.sh' "$ROOT/scripts/dev/start-platform.sh" \
  || fail "start-platform must delegate to bootstrap"

[[ -f "$ROOT/docs/development/dev-platform-environment-contract.md" ]] \
  || fail "missing environment contract doc"
grep -q '55432' "$ROOT/docs/development/dev-platform-environment-contract.md" \
  && grep -q '55440' "$ROOT/docs/development/dev-platform-environment-contract.md" \
  && grep -q '55441' "$ROOT/docs/development/dev-platform-environment-contract.md" \
  || fail "contract doc must document all three DB ports"

ok "dev platform contract checks passed"
