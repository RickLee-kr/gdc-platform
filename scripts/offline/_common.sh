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

offline_docker_engine_ready() {
  command -v docker >/dev/null 2>&1 \
    && docker compose version >/dev/null 2>&1 \
    && docker info >/dev/null 2>&1
}

offline_docker_debs_dir() {
  printf '%s/packages/docker/debs' "${OFFLINE_PACKAGE_ROOT:?}"
}

offline_docker_debs_available() {
  local dir
  dir="$(offline_docker_debs_dir)"
  [[ -d "$dir" ]] || return 1
  shopt -s nullglob
  local debs=("$dir"/*.deb)
  [[ "${#debs[@]}" -gt 0 ]]
}

# Install Docker from the offline bundle when missing. Set GDC_OFFLINE_SKIP_DOCKER_INSTALL=1 to skip.
offline_ensure_docker_engine() {
  if offline_docker_engine_ready; then
    return 0
  fi

  local installer="$OFFLINE_PACKAGE_ROOT/scripts/install-docker-offline.sh"
  if [[ "${GDC_OFFLINE_SKIP_DOCKER_INSTALL:-0}" == "1" ]]; then
    offline_die "Docker is not ready and GDC_OFFLINE_SKIP_DOCKER_INSTALL=1. Run: sudo scripts/install-docker-offline.sh"
  fi
  if [[ ! -x "$installer" ]] || ! offline_docker_debs_available; then
    offline_die "Docker is not installed and no offline .deb bundle found under packages/docker/debs/. Run on a connected host: scripts/offline/collect-docker-debs.sh, rebuild package, or install Docker manually."
  fi

  echo "[$(offline_ts)] Docker not found — installing from packages/docker/debs ..."
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    if ! command -v sudo >/dev/null 2>&1; then
      offline_die "Docker missing and sudo unavailable. Run as root: sudo scripts/install-docker-offline.sh"
    fi
    sudo -E bash "$installer"
  else
    bash "$installer"
  fi

  if offline_docker_engine_ready; then
    return 0
  fi
  if [[ "${EUID:-$(id -u)}" -ne 0 ]] && getent group docker >/dev/null 2>&1; then
    if ! id -nG 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
      offline_die "Docker was installed but this shell is not in the docker group. Run: newgrp docker   then re-run scripts/install-offline.sh"
    fi
  fi
  offline_die "Docker install finished but daemon is still not reachable (docker info failed)."
}
