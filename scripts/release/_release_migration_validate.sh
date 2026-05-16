# shellcheck shell=bash
# Pre-migration validate_migrations exit handling for release install/upgrade scripts.
# Keep exit code values in sync with app/db/validate_migrations.py.

GDC_MIG_VALIDATE_EXIT_OK=0
GDC_MIG_VALIDATE_EXIT_FRESH_BOOTSTRAP=2
GDC_MIG_VALIDATE_EXIT_WARN=3
GDC_MIG_VALIDATE_EXIT_ERROR=11

gdc_release_handle_pre_migration_validate_rc() {
  local rc="${1:?validate_migrations exit code required}"
  case "$rc" in
  "$GDC_MIG_VALIDATE_EXIT_OK")
    return 0
    ;;
  "$GDC_MIG_VALIDATE_EXIT_FRESH_BOOTSTRAP")
    echo "INFO: Fresh database bootstrap state detected."
    echo "INFO: Proceeding with initial Alembic upgrade."
    return 0
    ;;
  "$GDC_MIG_VALIDATE_EXIT_WARN")
    echo "WARN: Migration integrity reported warnings (see output above)." >&2
    return 0
    ;;
  *)
    echo "ERROR: Migration integrity check failed before alembic upgrade (exit ${rc})." >&2
    return 1
    ;;
  esac
}
