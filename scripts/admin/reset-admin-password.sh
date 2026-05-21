#!/usr/bin/env bash
# Explicit operator recovery: reset platform user 'admin' password hash only.
# Never run automatically; does not truncate DB or touch connectors/streams/etc.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.platform.yml"
COMPOSE=(docker compose -f "$COMPOSE_FILE")
ENV_FILE="$ROOT/.env"

usage() {
  cat <<'EOF'
Usage: scripts/admin/reset-admin-password.sh

Reset the persisted password hash for platform user 'admin' to match
GDC_SEED_ADMIN_PASSWORD (minimum 8 characters). Requires interactive
confirmation. Does not delete volumes or recreate catalog entities.

Password source (first match wins):
  1. GDC_SEED_ADMIN_PASSWORD in the environment
  2. GDC_SEED_ADMIN_PASSWORD in .env

After reset, the user must sign in with the new password and complete the
mandatory password-change gate (must_change_password=true, token_version bumped).

See also: docs/operations/migration-integrity-validation.md
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

for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $arg (use --help)" ;;
  esac
done

command -v docker >/dev/null 2>&1 || fail "docker is required"
"${COMPOSE[@]}" ps -q api >/dev/null 2>&1 || fail "api service is not running; start the platform first"

seed_pw="$(env_or_file GDC_SEED_ADMIN_PASSWORD "")"
[[ -n "$seed_pw" ]] || fail "GDC_SEED_ADMIN_PASSWORD must be set (8+ characters) in the environment or .env"
((${#seed_pw} >= 8)) || fail "GDC_SEED_ADMIN_PASSWORD must be at least 8 characters"

admin_count="$("${COMPOSE[@]}" exec -T postgres psql -U gdc -d gdc -Atc \
  "SELECT count(*) FROM platform_users WHERE username = 'admin' AND role = 'ADMINISTRATOR' AND status = 'ACTIVE'" \
  | tr -d '[:space:]')"
[[ "$admin_count" =~ ^[0-9]+$ ]] && (( admin_count > 0 )) \
  || fail "platform user 'admin' is missing; run: docker compose -f docker-compose.platform.yml exec api python -m app.db.seed --platform-admin-only"

echo "This will reset ONLY the password hash for platform user 'admin'."
echo "Connectors, streams, routes, destinations, checkpoints, and other users are preserved."
echo "Outstanding JWT sessions for 'admin' will be invalidated (token_version bump)."
echo ""
read -r -p "Type YES to continue: " confirm
[[ "$confirm" == "YES" ]] || fail "aborted (confirmation was not YES)"

echo "Resetting admin password hash from GDC_SEED_ADMIN_PASSWORD..."
"${COMPOSE[@]}" exec -T \
  -e "GDC_SEED_ADMIN_PASSWORD=${seed_pw}" \
  api \
  python -m app.db.seed --platform-admin-only --reset-platform-admin-password

echo "Done. Sign in as admin with the password from GDC_SEED_ADMIN_PASSWORD, then change it when prompted."
