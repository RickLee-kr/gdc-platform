# shellcheck shell=bash
# Pre-migration validate_migrations exit handling for release install/upgrade scripts.
# Keep exit code values in sync with app/db/validate_migrations.py.

GDC_MIG_VALIDATE_EXIT_OK=0
GDC_MIG_VALIDATE_EXIT_FRESH_BOOTSTRAP=2
GDC_MIG_VALIDATE_EXIT_WARN=3
GDC_MIG_VALIDATE_EXIT_ERROR=11

GDC_MIG_VALIDATE_FRESH_MARK="Fresh database detected"

gdc_release_normalize_pre_migration_validate_rc() {
  local rc="${1:?validate_migrations exit code required}"
  local log_file="${2:?validate_migrations log file required}"
  case "$rc" in
  "$GDC_MIG_VALIDATE_EXIT_OK" | "$GDC_MIG_VALIDATE_EXIT_FRESH_BOOTSTRAP" | "$GDC_MIG_VALIDATE_EXIT_WARN")
    echo "$rc"
    return 0
    ;;
  esac
  if [[ -f "$log_file" ]] \
    && grep -q "$GDC_MIG_VALIDATE_FRESH_MARK" "$log_file" \
    && ! grep -q '^ERROR:' "$log_file"; then
    echo "$GDC_MIG_VALIDATE_EXIT_FRESH_BOOTSTRAP"
    return 0
  fi
  echo "$rc"
}

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

# Run validate_migrations --pre-upgrade with errexit/ERR-trap safe capture and install handling.
gdc_release_run_pre_migration_validate() {
  local compose_rel="${1:?compose file required}"
  local log_file rc normalized_rc errexit_was=0
  log_file="$(mktemp)"
  [[ $- == *e* ]] && errexit_was=1
  set +e
  docker compose -f "$compose_rel" run --rm --no-deps api \
    python -m app.db.validate_migrations --pre-upgrade >"$log_file" 2>&1
  rc=$?
  cat "$log_file"
  normalized_rc="$(gdc_release_normalize_pre_migration_validate_rc "$rc" "$log_file")"
  rm -f "$log_file"
  if [[ "$errexit_was" -eq 1 ]]; then
    set -e
  fi
  gdc_release_handle_pre_migration_validate_rc "$normalized_rc"
}
