#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEBS_DIR="$SCRIPT_DIR/docker-debs"
DEBS_MANIFEST="$SCRIPT_DIR/checksums/DEBS.manifest"

die() { echo "ERROR: $*" >&2; exit 1; }

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  die "Run as root: sudo ./offline_install/install-docker.sh"
fi

docker_ready() {
  command -v docker >/dev/null 2>&1 \
    && docker compose version >/dev/null 2>&1 \
    && docker info >/dev/null 2>&1
}

verify_os() {
  [[ -r /etc/os-release ]] || return 0
  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID:-}" == "ubuntu" ]] || die "Target OS is not Ubuntu (ID=${ID:-unknown})."
  if [[ "${VERSION_ID:-}" != "24.04" && "${VERSION_CODENAME:-}" != "noble" ]]; then
    echo "WARN: Bundle targets Ubuntu 24.04 but host is ${VERSION_ID:-unknown}." >&2
  fi
}

verify_required_debs() {
  [[ -d "$DEBS_DIR" ]] || die "Missing docker-debs directory: $DEBS_DIR"
  local required_prefixes=(
    "containerd.io_"
    "docker-ce_"
    "docker-ce-cli_"
    "docker-buildx-plugin_"
    "docker-compose-plugin_"
  )
  local prefix
  shopt -s nullglob
  for prefix in "${required_prefixes[@]}"; do
    matches=("$DEBS_DIR/${prefix}"*.deb)
    [[ "${#matches[@]}" -gt 0 ]] || die "Missing required deb package prefix: ${prefix}*.deb"
  done
  [[ -f "$DEBS_MANIFEST" ]] || die "Missing required manifest: $DEBS_MANIFEST"
}

install_debs() {
  shopt -s nullglob
  local debs=("$DEBS_DIR"/*.deb)
  [[ "${#debs[@]}" -gt 0 ]] || die "No .deb files found under $DEBS_DIR"

  export DEBIAN_FRONTEND=noninteractive
  echo "[docker] Installing ${#debs[@]} package(s) ..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get install -y --no-install-recommends "${debs[@]}"
  else
    dpkg -i "${debs[@]}" || die "dpkg install failed."
  fi
}

start_daemon() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable docker || true
    systemctl restart docker
  fi
}

main() {
  if docker_ready; then
    echo "Docker is already installed and running."
    docker --version
    docker compose version
    exit 0
  fi

  verify_os
  verify_required_debs
  install_debs
  start_daemon

  for _ in $(seq 1 20); do
    docker_ready && break
    sleep 2
  done
  docker_ready || die "Docker install finished but daemon is not reachable."

  echo "Docker offline install complete."
  docker --version
  docker compose version
}

main "$@"
