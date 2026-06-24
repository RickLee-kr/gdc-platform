# shellcheck shell=bash
# Shared helpers for offline install scripts (sourced, not executed directly).

offline_die() {
  echo "ERROR: $*" >&2
  exit 1
}

offline_ts() {
  date '+%Y-%m-%d %H:%M:%S'
}

# Resolve package root: parent of scripts/ when running from an extracted offline-release tree.
offline_resolve_package_root() {
  local script_dir="${1:-}"
  if [[ -z "$script_dir" ]]; then
    offline_die "offline_resolve_package_root: script_dir required"
  fi
  cd "$(dirname "$script_dir")/.." && pwd
}

offline_compose_file() {
  printf '%s/configs/docker-compose.offline.yml' "${OFFLINE_PACKAGE_ROOT:?}"
}

offline_env_file() {
  printf '%s/configs/.env' "${OFFLINE_PACKAGE_ROOT:?}"
}

offline_env_template() {
  printf '%s/configs/.env.production.template' "${OFFLINE_PACKAGE_ROOT:?}"
}

offline_compose() {
  docker compose -f "$(offline_compose_file)" --env-file "$(offline_env_file)" "$@"
}

offline_read_env() {
  local key="$1"
  python3 - "$(offline_env_file)" "$key" <<'PY'
import re
import sys
from pathlib import Path

path, key = Path(sys.argv[1]), sys.argv[2]
if not path.is_file():
    sys.exit(0)
pat = re.compile(rf"^\s*{re.escape(key)}\s*=\s*(.*)\s*$")
for line in reversed(path.read_text(encoding="utf-8").splitlines()):
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    m = pat.match(line)
    if not m:
        continue
    val = m.group(1).strip()
    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
        val = val[1:-1]
    print(val, end="")
    break
PY
}

offline_http_port() {
  local port
  port="$(offline_read_env GDC_HTTP_PORT)"
  [[ -n "$port" ]] || port="18080"
  printf '%s' "$port"
}

offline_confirm_destructive() {
  local prompt="${1:-Type YES to continue:}"
  local answer
  echo ""
  echo "WARNING: This operation deletes production Docker data and cannot be undone."
  read -r -p "$prompt " answer
  [[ "$answer" == "YES" ]] || offline_die "Aborted (confirmation not received)."
}
