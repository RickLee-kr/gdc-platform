#!/usr/bin/env bash
# Install Docker Engine + Compose v2 from packages/docker/debs/ (no internet required).
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/_common.sh
source "$SCRIPT_DIR/_common.sh"

OFFLINE_PACKAGE_ROOT="$(offline_resolve_package_root "$SCRIPT_DIR")"
export OFFLINE_PACKAGE_ROOT

DEBS_DIR="$OFFLINE_PACKAGE_ROOT/packages/docker/debs"
MANIFEST="$OFFLINE_PACKAGE_ROOT/packages/docker/DEBS.manifest"

die() { echo "ERROR: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: install-docker-offline.sh

Install Docker Engine and Compose plugin v2 from packages/docker/debs/*.deb.
Must run as root (or via sudo).

After install:
  docker --version
  docker compose version
  systemctl status docker

If you were not root, log out/in or run: newgrp docker
EOF
}

docker_engine_ready() {
  command -v docker >/dev/null 2>&1 \
    && docker compose version >/dev/null 2>&1 \
    && docker info >/dev/null 2>&1
}

verify_ubuntu_target() {
  if [[ ! -r /etc/os-release ]]; then
    echo "WARN: Cannot verify target OS." >&2
    return 0
  fi
  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    die "Target OS is not Ubuntu (ID=${ID:-unknown}). Bundle targets Ubuntu 24.04."
  fi
  if [[ "${VERSION_ID:-}" != "24.04" && "${VERSION_CODENAME:-}" != "noble" ]]; then
    echo "WARN: Target is not Ubuntu 24.04 (VERSION_ID=${VERSION_ID:-?}). Proceed with caution." >&2
  fi
}

install_debs() {
  shopt -s nullglob
  local debs=("$DEBS_DIR"/*.deb)
  [[ "${#debs[@]}" -gt 0 ]] || die "No .deb files in $DEBS_DIR"

  export DEBIAN_FRONTEND=noninteractive

  echo "[$(offline_ts)] Installing ${#debs[@]} .deb package(s) from $DEBS_DIR ..."
  # apt install resolves local .deb dependency order better than a single dpkg -i pass.
  if command -v apt-get >/dev/null 2>&1; then
    apt-get install -y --no-install-recommends "${debs[@]}"
  else
    dpkg -i "${debs[@]}" || die "dpkg install failed (try: apt-get install -y ${debs[*]})"
  fi
}

enable_docker_service() {
  echo "[$(offline_ts)] Enabling Docker service..."
  systemctl enable docker
  systemctl restart docker
  for _ in $(seq 1 15); do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  die "Docker daemon did not become ready. Check: journalctl -u docker --no-pager"
}

add_user_to_docker_group() {
  local target="${SUDO_USER:-${GDC_OFFLINE_DOCKER_USER:-}}"
  if [[ -z "$target" || "$target" == "root" ]]; then
    return 0
  fi
  if id -nG "$target" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
    echo "[$(offline_ts)] User $target already in docker group."
    return 0
  fi
  echo "[$(offline_ts)] Adding user $target to docker group..."
  usermod -aG docker "$target" || true
  echo "NOTE: User $target must log out/in or run 'newgrp docker' before using docker without sudo."
}

print_versions() {
  echo ""
  echo "Docker binaries:"
  docker --version
  docker compose version
}

main() {
  [[ "${1:-}" != "-h" && "${1:-}" != "--help" ]] || { usage; exit 0; }

  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    die "Run as root: sudo $0"
  fi

  if docker_engine_ready; then
    echo "Docker Engine and Compose v2 are already installed and the daemon is running."
    print_versions
    exit 0
  fi

  [[ -d "$DEBS_DIR" ]] || die "Missing $DEBS_DIR (rebuild offline package with Docker .deb bundle)"
  verify_ubuntu_target

  echo "============================================================"
  echo "Data Relay — offline Docker install"
  echo "============================================================"
  echo "Package:  $OFFLINE_PACKAGE_ROOT"
  echo "Deb dir:  $DEBS_DIR"
  [[ -f "$MANIFEST" ]] && echo "Manifest: $MANIFEST"
  echo ""

  install_debs
  enable_docker_service
  add_user_to_docker_group
  print_versions

  echo ""
  echo "Docker offline install complete."
}

main "$@"
