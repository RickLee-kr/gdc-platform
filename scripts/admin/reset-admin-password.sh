#!/usr/bin/env bash
# Official operator recovery: reset platform admin password hash only (no DB wipe).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.platform.yml"
COMPOSE=(docker compose -f "$COMPOSE_FILE")
ENV_FILE="$ROOT/.env"

ADMIN_USERNAME="admin"
ADMIN_PASSWORD=""
SKIP_CONFIRM=false

usage() {
  cat <<'EOF'
Usage: scripts/admin/reset-admin-password.sh [options]

Official recovery for the platform administrator password (default user: admin).
Never runs from bootstrap/install automatically. Does not drop the database,
truncate tables, recreate Docker volumes, or modify operational configuration.

Preserves connectors, streams, routes, mappings, enrichments, destinations,
checkpoints, delivery_logs, runtime state, and stored credentials.

Examples:
  GDC_SEED_ADMIN_PASSWORD='YourNewPwd1!' ./scripts/admin/reset-admin-password.sh
  ./scripts/admin/reset-admin-password.sh --password 'YourNewPwd1!'

Options:
  --username NAME       Platform username (default: admin)
  --password PW         New password (minimum 8 characters); prompts if omitted
  --yes                 Skip interactive YES confirmation (use with care)
  -h, --help            Show this help

See docs/operations/administration/admin-password-reset.md
EOF
}

env_or_file() {
  local key="$1" default="$2"
  if [[ -n "${!key:-}" ]]; then
    printf '%s' "${!key}"
    return 0
  fi
  python3 - "$ENV_FILE" "$key" "$default" <<'PY'
import re
import sys
from pathlib import Path

path, key, default = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    lines = Path(path).read_text(encoding="utf-8").splitlines()
except OSError:
    print(default, end="")
    raise SystemExit(0)
pat = re.compile(rf"^\s*{re.escape(key)}\s*=\s*(.*)\s*$")
for line in reversed(lines):
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    match = pat.match(line)
    if not match:
        continue
    value = match.group(1).strip().strip('"').strip("'")
    print(value or default, end="")
    break
else:
    print(default, end="")
PY
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --username)
      [[ $# -ge 2 && -n "${2:-}" ]] || fail "--username requires a value"
      ADMIN_USERNAME="$2"
      shift 2
      ;;
    --password)
      [[ $# -ge 2 ]] || fail "--password requires a value"
      ADMIN_PASSWORD="$2"
      shift 2
      ;;
    --yes) SKIP_CONFIRM=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1 (use --help)" ;;
  esac
done

command -v docker >/dev/null 2>&1 || fail "docker is required"
"${COMPOSE[@]}" ps -q api >/dev/null 2>&1 || fail "api service is not running; run ./scripts/dev/bootstrap-dev-platform.sh first"

if [[ "$ADMIN_USERNAME" != "admin" ]]; then
  fail "only platform user 'admin' is supported (got: $ADMIN_USERNAME)"
fi

if [[ -z "$ADMIN_PASSWORD" ]]; then
  if [[ -n "${GDC_SEED_ADMIN_PASSWORD:-}" ]]; then
    ADMIN_PASSWORD="${GDC_SEED_ADMIN_PASSWORD}"
  else
    from_file="$(env_or_file GDC_SEED_ADMIN_PASSWORD "")"
    if [[ -n "$from_file" ]]; then
      ADMIN_PASSWORD="$from_file"
    fi
  fi
fi

if [[ -z "$ADMIN_PASSWORD" ]]; then
  if [[ -t 0 ]]; then
    read -r -s -p "New password for '$ADMIN_USERNAME' (min 8 chars): " ADMIN_PASSWORD
    echo ""
    read -r -s -p "Confirm password: " confirm_pw
    echo ""
    [[ "$ADMIN_PASSWORD" == "$confirm_pw" ]] || fail "passwords do not match"
  else
    fail "no password provided (use --password or GDC_SEED_ADMIN_PASSWORD or an interactive terminal)"
  fi
fi

((${#ADMIN_PASSWORD} >= 8)) || fail "password must be at least 8 characters"

admin_count="$("${COMPOSE[@]}" exec -T postgres psql -U gdc -d gdc -Atc \
  "SELECT count(*) FROM platform_users WHERE username = 'admin' AND role = 'ADMINISTRATOR' AND status = 'ACTIVE'" \
  | tr -d '[:space:]')"

echo "Platform admin user found: username=$ADMIN_USERNAME (count=${admin_count:-0})"
echo "Operational data (connectors, streams, routes, mappings, enrichments,"
echo "destinations, checkpoints, delivery_logs) will be preserved."
echo "Outstanding JWT sessions for '$ADMIN_USERNAME' will be invalidated (token_version bump)."
echo ""

if [[ "$SKIP_CONFIRM" != "true" ]]; then
  read -r -p "Type YES to continue: " confirm
  [[ "$confirm" == "YES" ]] || fail "aborted (confirmation was not YES)"
fi

echo "Applying admin password reset inside api container..."
seed_out="$("${COMPOSE[@]}" exec -T \
  -e "GDC_SEED_ADMIN_PASSWORD=${ADMIN_PASSWORD}" \
  -e "GDC_RECONCILE_ADMIN_PASSWORD=true" \
  api \
  python -m app.db.seed --platform-admin-only 2>&1)" || fail "password reset command failed (see output above)"

printf '%s\n' "$seed_out"

if ! printf '%s' "$seed_out" | grep -q "'password_reconcile': True"; then
  if printf '%s' "$seed_out" | grep -q "'created': True"; then
    echo "[admin-reset] admin created (no prior row)"
  else
    fail "password reset did not report password_reconcile=true (see output above)"
  fi
fi

if ! printf '%s' "$seed_out" | grep -q '\[admin-reset\]'; then
  fail "expected [admin-reset] summary block in seed output"
fi

echo ""
echo "Login username: $ADMIN_USERNAME"
echo "Sign in with the new password, then complete the mandatory password-change gate in the UI."
echo "Validate:"
echo "  GDC_VALIDATE_ADMIN_PASSWORD='<password>' ./scripts/dev/validate-platform-ready.sh"
