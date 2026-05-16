#!/usr/bin/env bash
# Static checks for one-command clean install readiness (no Docker required).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE="$ROOT/docker-compose.platform.yml"
ENV_EXAMPLE="$ROOT/.env.example"
INSTALL_SH="$ROOT/scripts/release/install.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "OK: $*"; }

[[ -f "$ENV_EXAMPLE" ]] || fail ".env.example is missing at repository root (must be committed; see .gitignore !.env.example)"
ok ".env.example exists"

[[ -f "$COMPOSE" ]] || fail "docker-compose.platform.yml missing"
ok "docker-compose.platform.yml exists"

if grep -q 'gdc-platform-test_gdc_test_postgres_data' "$COMPOSE"; then
  fail "docker-compose.platform.yml still references legacy external volume gdc-platform-test_gdc_test_postgres_data"
fi
if grep -A3 '^  gdc-test:' "$COMPOSE" 2>/dev/null | grep -q 'external:[[:space:]]*true'; then
  fail "docker-compose.platform.yml still requires external dev-validation network gdc-test"
fi
if grep -A3 'gdc_test_postgres_data:' "$COMPOSE" 2>/dev/null | grep -q 'external:[[:space:]]*true'; then
  fail "docker-compose.platform.yml still requires legacy external postgres volume"
fi
ok "platform compose has no required dev/test external network or legacy postgres volume"

if ! grep -qE 'POSTGRES_DB:[[:space:]]*(\$\{POSTGRES_DB:-datarelay\}|datarelay)' "$COMPOSE"; then
  fail "docker-compose.platform.yml POSTGRES_DB must default to datarelay"
fi
ok "POSTGRES_DB defaults to datarelay in platform compose"

if ! grep -q 'datarelay_postgres_data:' "$COMPOSE"; then
  fail "docker-compose.platform.yml must declare compose-managed volume datarelay_postgres_data"
fi
ok "compose-managed volume datarelay_postgres_data is declared"

for key in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL; do
  grep -qE "^${key}=" "$ENV_EXAMPLE" || fail ".env.example missing required key: $key"
done
if ! grep -qE '^DATABASE_URL=postgresql://datarelay:' "$ENV_EXAMPLE"; then
  fail ".env.example DATABASE_URL must use datarelay role and postgresql:// scheme"
fi
ok ".env.example contains required production keys"

for fn in ensure_docker_ready bootstrap_env validate_required_ports_free verify_reverse_proxy_health; do
  grep -q "$fn" "$INSTALL_SH" || fail "install.sh missing function or step: $fn"
done
MIG_VALIDATE_SH="$ROOT/scripts/release/_release_migration_validate.sh"
[[ -f "$MIG_VALIDATE_SH" ]] || fail "_release_migration_validate.sh missing"
for const in GDC_MIG_VALIDATE_EXIT_OK GDC_MIG_VALIDATE_EXIT_FRESH_BOOTSTRAP GDC_MIG_VALIDATE_EXIT_ERROR; do
  grep -q "$const" "$MIG_VALIDATE_SH" || fail "_release_migration_validate.sh missing exit constant: $const"
done
grep -q 'gdc_release_run_pre_migration_validate' "$MIG_VALIDATE_SH" \
  || fail "_release_migration_validate.sh must define gdc_release_run_pre_migration_validate"
grep -q 'gdc_release_normalize_pre_migration_validate_rc' "$MIG_VALIDATE_SH" \
  || fail "_release_migration_validate.sh must normalize docker compose exit codes from validate output"
grep -q 'gdc_release_run_pre_migration_validate' "$INSTALL_SH" \
  || fail "install.sh must run pre-migration validate via gdc_release_run_pre_migration_validate"
grep -q 'set +e' "$MIG_VALIDATE_SH" \
  || fail "_release_migration_validate.sh must disable errexit while capturing validate_migrations RC"
grep -q 'Fresh database bootstrap state detected' "$MIG_VALIDATE_SH" \
  || fail "_release_migration_validate.sh must log fresh bootstrap INFO messages"

for fn in user_in_docker_group die_docker_group_refresh_required; do
  grep -q "$fn" "$INSTALL_SH" || fail "install.sh missing Docker group helper: $fn"
done
grep -q 'newgrp docker' "$INSTALL_SH" || fail "install.sh must guide newgrp docker after docker group membership"
if grep -q 'sudo usermod -aG docker' "$INSTALL_SH" && ! grep -q 'user_in_docker_group' "$INSTALL_SH"; then
  fail "install.sh must not suggest usermod when user is already in docker group (use user_in_docker_group)"
fi
ok "install.sh includes clean-install bootstrap helpers"

MIGRATION_INTEGRITY="$ROOT/app/db/migration_integrity.py"
grep -q 'Fresh database detected (no alembic_version found)' "$MIGRATION_INTEGRITY" \
  || fail "migration_integrity.py must allow fresh empty DB bootstrap (--pre-upgrade)"
grep -q 'Application tables exist but alembic_version is missing' "$MIGRATION_INTEGRITY" \
  || fail "migration_integrity.py must reject partial schema without alembic_version"
ok "migration_integrity.py documents fresh bootstrap and partial-schema guards"

grep -q 'validate_migrations --pre-upgrade' "$MIG_VALIDATE_SH" \
  || fail "_release_migration_validate.sh must run validate_migrations --pre-upgrade"
grep -q 'gdc_release_run_pre_migration_validate' "$INSTALL_SH" \
  || fail "install.sh must invoke gdc_release_run_pre_migration_validate before alembic upgrade head"
grep -q 'alembic upgrade head' "$INSTALL_SH" \
  || fail "install.sh must run alembic upgrade head after pre-upgrade validation"
ok "install.sh runs pre-upgrade validation then alembic upgrade head"

for rel in \
  frontend/src/components/logs/logs-explorer-page.tsx \
  frontend/src/components/logs/logs-types.ts \
  app/logs/models.py \
  app/logs/repository.py; do
  git -C "$ROOT" cat-file -e "HEAD:$rel" 2>/dev/null || fail "required source missing from git HEAD: $rel"
done
ok "logs explorer frontend and app/logs backend sources are committed"

if [[ ! -x "$INSTALL_SH" ]] && [[ -f "$INSTALL_SH" ]]; then
  echo "WARN: install.sh is not executable; run: chmod +x scripts/release/install.sh" >&2
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  merged_db="$(
    (cd "$ROOT" && docker compose -f docker-compose.platform.yml config 2>/dev/null) \
      | awk '/^  postgres:$/{p=1;next} p&&/^      POSTGRES_DB:/{sub(/^      POSTGRES_DB:[[:space:]]*/,"");gsub(/["'\'']$/,"");gsub(/^["'\'']/,"");print;exit}'
  )"
  if [[ -n "${merged_db:-}" && "$merged_db" != "datarelay" ]]; then
    fail "merged compose POSTGRES_DB is '$merged_db' (expected datarelay)"
  fi
  ok "docker compose config merges POSTGRES_DB=datarelay"
else
  echo "SKIP: docker compose config (Docker not available in this environment)"
fi

echo ""
echo "validate-clean-install: all checks passed"
