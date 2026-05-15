#!/usr/bin/env bash
# Restore PostgreSQL from a pg_dump custom-format archive using pg_restore.
# DESTRUCTIVE to database contents relative to the dump — requires explicit confirmation.
#
# Safety:
#   - Requires CONFIRM_RESTORE=yes (exact).
#   - Refuses empty or structurally invalid DATABASE_URL.
#   - Creates a pre-restore backup (read-only pg_dump) before pg_restore.
#   - Does not pass --clean (no DROP objects from pg_restore).
#   - Does not modify application checkpoints by itself (dump/restore is DB-level).
#
# Usage:
#   CONFIRM_RESTORE=yes DATABASE_URL=postgresql://... ./scripts/ops/restore-postgres.sh /path/to/file.dump
#   # .dump.gz supported
#
# Env:
#   DATABASE_URL              (required) Target database for restore.
#   CONFIRM_RESTORE           Must be exactly "yes".
#   PRE_RESTORE_BACKUP_DIR    Where to write the automatic pre-restore backup (default: sibling pre-restore under BACKUP_DIR).
#   BACKUP_DIR                Passed to backup-postgres.sh for pre-restore dump (default: <repo>/var/backups/postgres).
#   PGRESTORE_JOBS            Optional parallel jobs (default: 4). Set to 1 to disable parallelism.
#
# Logs: never prints the full DATABASE_URL.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

usage() {
  sed -n '1,35p' "$0" | tail -n +2
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "================================================================"
echo "  GDC PostgreSQL restore (pg_restore)"
echo "================================================================"

if [[ "${CONFIRM_RESTORE:-}" != "yes" ]]; then
  echo "ERROR: Refusing to run without explicit confirmation." >&2
  echo "Set CONFIRM_RESTORE=yes after reviewing docs/admin/backup-restore.md" >&2
  echo "----------------------------------------------------------------"
  echo "  RESULT: FAILURE (missing CONFIRM_RESTORE=yes)"
  echo "----------------------------------------------------------------"
  exit 1
fi

DUMP_PATH="${1:-}"
if [[ -z "$DUMP_PATH" ]]; then
  echo "ERROR: Pass the path to a .dump or .dump.gz file as the first argument." >&2
  echo "----------------------------------------------------------------"
  echo "  RESULT: FAILURE (no dump file argument)"
  echo "----------------------------------------------------------------"
  exit 1
fi

if [[ ! -f "$DUMP_PATH" ]]; then
  echo "ERROR: Dump file not found: $DUMP_PATH" >&2
  echo "----------------------------------------------------------------"
  echo "  RESULT: FAILURE (dump missing)"
  echo "----------------------------------------------------------------"
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set or is empty." >&2
  echo "----------------------------------------------------------------"
  echo "  RESULT: FAILURE (DATABASE_URL empty)"
  echo "----------------------------------------------------------------"
  exit 1
fi

python3 - <<'PY' || exit 1
import os
import sys
from urllib.parse import urlparse

raw = (os.environ.get("DATABASE_URL") or "").strip()
if not raw:
    print("ERROR: DATABASE_URL is empty.", file=sys.stderr)
    sys.exit(1)
u = urlparse(raw)
if u.scheme not in ("postgresql", "postgres"):
    print("ERROR: DATABASE_URL must use postgresql:// or postgres:// scheme.", file=sys.stderr)
    sys.exit(1)
path = (u.path or "").strip("/")
db = path.split("/")[0] if path else ""
if not db:
    print("ERROR: DATABASE_URL must include a database name.", file=sys.stderr)
    sys.exit(1)
host = u.hostname or "(local socket)"
print(f"  Target (sanitized): host={host!s} port={u.port!s} db={db!s} user={(u.username or '')!s}")
PY

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "ERROR: pg_restore not found in PATH. Install PostgreSQL client tools." >&2
  echo "----------------------------------------------------------------"
  echo "  RESULT: FAILURE (pg_restore missing)"
  echo "----------------------------------------------------------------"
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not found in PATH (required for pre-restore backup)." >&2
  echo "----------------------------------------------------------------"
  echo "  RESULT: FAILURE (pg_dump missing)"
  echo "----------------------------------------------------------------"
  exit 1
fi

BACKUP_SCRIPT="$SCRIPT_DIR/backup-postgres.sh"
if [[ ! -f "$BACKUP_SCRIPT" ]]; then
  echo "ERROR: backup script missing: $BACKUP_SCRIPT" >&2
  exit 1
fi

PRE_DIR="${PRE_RESTORE_BACKUP_DIR:-${BACKUP_DIR:-$ROOT/var/backups/postgres}/pre-restore}"
export BACKUP_DIR="$PRE_DIR"
mkdir -p "$BACKUP_DIR"

echo "  Step 1/2: pre-restore backup (read-only) → $BACKUP_DIR"
set +e
bash "$BACKUP_SCRIPT"
PRE_RC=$?
set -e
if [[ "$PRE_RC" -ne 0 ]]; then
  echo "ERROR: Pre-restore backup failed (exit $PRE_RC). Aborting restore." >&2
  echo "----------------------------------------------------------------"
  echo "  RESULT: FAILURE (pre-restore backup)"
  echo "----------------------------------------------------------------"
  exit "$PRE_RC"
fi

JOBS="${PGRESTORE_JOBS:-4}"
if ! [[ "$JOBS" =~ ^[0-9]+$ ]] || [[ "$JOBS" -lt 1 ]]; then
  echo "ERROR: PGRESTORE_JOBS must be a positive integer." >&2
  exit 1
fi

RESTORE_LABEL="$(basename "$DUMP_PATH")"
echo "  Step 2/2: pg_restore from $RESTORE_LABEL (no --clean; --no-owner --no-acl)"
echo "  Jobs: $JOBS"

set +e
if [[ "$DUMP_PATH" == *.gz ]]; then
  TMP_DUMP="$(mktemp "${TMPDIR:-/tmp}/gdc-restore.XXXXXX")"
  trap 'rm -f "$TMP_DUMP"' EXIT
  if ! gzip -dc "$DUMP_PATH" >"$TMP_DUMP"; then
    echo "ERROR: gzip decompress failed for $DUMP_PATH" >&2
    echo "----------------------------------------------------------------"
    echo "  RESULT: FAILURE (gzip)"
    echo "----------------------------------------------------------------"
    exit 1
  fi
  pg_restore --no-owner --no-acl --jobs="$JOBS" --verbose --dbname="$DATABASE_URL" "$TMP_DUMP"
else
  pg_restore --no-owner --no-acl --jobs="$JOBS" --verbose --dbname="$DATABASE_URL" "$DUMP_PATH"
fi
REST_RC=$?
set -e

if [[ "$REST_RC" -ne 0 ]]; then
  echo "----------------------------------------------------------------"
  echo "  RESULT: FAILURE (pg_restore exit $REST_RC)"
  echo "  Review messages above; pre-restore backup is under: $BACKUP_DIR"
  echo "----------------------------------------------------------------"
  exit "$REST_RC"
fi

echo "----------------------------------------------------------------"
echo "  RESULT: SUCCESS"
echo "  Restored from: $DUMP_PATH"
echo "  Pre-restore backup directory: $BACKUP_DIR"
echo "----------------------------------------------------------------"
