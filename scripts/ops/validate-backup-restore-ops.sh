#!/usr/bin/env bash
# Non-destructive checks for backup/restore ops scripts:
# - bash -n syntax
# - restore refuses to run without CONFIRM_RESTORE=yes
# - restore refuses bad DATABASE_URL or missing dump before any pre-restore backup
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

B="$ROOT/scripts/ops/backup-postgres.sh"
R="$ROOT/scripts/ops/restore-postgres.sh"

echo "== bash -n =="
bash -n "$B"
bash -n "$R"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
touch "$TMP/exists.dump"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

echo "== restore: missing CONFIRM_RESTORE (expect failure) =="
set +e
out="$(DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' bash "$R" "$TMP/exists.dump" 2>&1)"
ec=$?
set -e
[[ "$ec" -ne 0 ]] || fail "expected non-zero exit without CONFIRM_RESTORE"
echo "$out" | grep -q 'CONFIRM_RESTORE' || fail "expected CONFIRM_RESTORE message"

echo "== restore: CONFIRM wrong value (expect failure) =="
set +e
out="$(CONFIRM_RESTORE=yep DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' bash "$R" "$TMP/exists.dump" 2>&1)"
ec=$?
set -e
[[ "$ec" -ne 0 ]] || fail "expected non-zero for CONFIRM_RESTORE!=yes"

echo "== restore: empty DATABASE_URL (expect failure before backup) =="
set +e
out="$(CONFIRM_RESTORE=yes DATABASE_URL='' bash "$R" "$TMP/exists.dump" 2>&1)"
ec=$?
set -e
[[ "$ec" -ne 0 ]] || fail "expected non-zero for empty DATABASE_URL"

echo "== restore: invalid scheme (expect failure) =="
set +e
out="$(CONFIRM_RESTORE=yes DATABASE_URL='mysql://u@h/db' bash "$R" "$TMP/exists.dump" 2>&1)"
ec=$?
set -e
[[ "$ec" -ne 0 ]] || fail "expected non-zero for non-postgres URL"

echo "== restore: missing dump file (expect failure) =="
set +e
out="$(CONFIRM_RESTORE=yes DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' bash "$R" "$TMP/nonexistent.dump" 2>&1)"
ec=$?
set -e
[[ "$ec" -ne 0 ]] || fail "expected non-zero for missing dump"

echo "== all validate-backup-restore-ops checks passed =="
