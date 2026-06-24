#!/usr/bin/env bash
# Download Docker Engine + Compose v2 .deb packages (with dependencies) for Ubuntu 24.04.
# Run on a connected Ubuntu 24.04 build host; output is copied into offline-release/packages/docker/debs/.
#
# Usage:
#   ./scripts/offline/collect-docker-debs.sh [OUTPUT_DIR]
# Environment:
#   GDC_DOCKER_DEB_UBUNTU_CODENAME  default: noble (24.04)
#   GDC_DOCKER_DEB_ARCH             default: dpkg --print-architecture
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_DIR="${1:-$ROOT/offline-release/packages/docker/debs}"
CODENAME="${GDC_DOCKER_DEB_UBUNTU_CODENAME:-noble}"
ARCH="${GDC_DOCKER_DEB_ARCH:-$(dpkg --print-architecture 2>/dev/null || echo amd64)}"

DOCKER_APT_PACKAGES=(
  docker-ce
  docker-ce-cli
  containerd.io
  docker-buildx-plugin
  docker-compose-plugin
)

die() { echo "ERROR: $*" >&2; exit 1; }

require_ubuntu_2404_build_host() {
  if [[ ! -r /etc/os-release ]]; then
    die "Cannot detect OS. Run on Ubuntu 24.04 to collect matching .deb packages."
  fi
  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    die "This collector targets Ubuntu (got ID=${ID:-unknown}). Build on Ubuntu 24.04."
  fi
  if [[ "${VERSION_ID:-}" != "24.04" && "${VERSION_CODENAME:-}" != "noble" ]]; then
    echo "WARN: Build host is not Ubuntu 24.04 (VERSION_ID=${VERSION_ID:-?})." >&2
    echo "      .deb packages are collected for codename=${CODENAME} arch=${ARCH}." >&2
  fi
}

docker_apt_repo_ready() {
  apt-cache show docker-ce >/dev/null 2>&1
}
setup_docker_apt_repo() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
  fi
  echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
}

collect_package_names() {
  local pkg
  for pkg in "${DOCKER_APT_PACKAGES[@]}"; do
    apt-cache depends --recurse --no-recommends --no-suggests \
      --no-conflicts --no-breaks --no-replaces --no-enhances \
      "$pkg" 2>/dev/null | grep -E '^[[:alnum:]][A-Za-z0-9+.-]*$' || true
  done | sort -u
}

download_debs() {
  mkdir -p "$OUTPUT_DIR"
  rm -f "$OUTPUT_DIR"/*.deb

  local names_file count name missing=0
  names_file="$(mktemp)"
  collect_package_names >"$names_file"
  count="$(wc -l <"$names_file" | tr -d ' ')"
  echo "[docker-debs] Downloading ${count} unique package(s) to $OUTPUT_DIR ..."

  (
    cd "$OUTPUT_DIR"
    while IFS= read -r name; do
      [[ -n "$name" ]] || continue
      if ! apt-get download "$name" 2>/dev/null; then
        echo "WARN: apt-get download failed for: $name" >&2
        missing=$((missing + 1))
      fi
    done <"$names_file"
  )
  rm -f "$names_file"

  local deb_count
  deb_count="$(find "$OUTPUT_DIR" -maxdepth 1 -name '*.deb' | wc -l | tr -d ' ')"
  [[ "$deb_count" -gt 0 ]] || die "No .deb files downloaded to $OUTPUT_DIR"

  if [[ "$missing" -gt 0 ]]; then
    echo "WARN: ${missing} package name(s) could not be downloaded (may already be satisfied by base image)." >&2
  fi

  echo "[docker-debs] Saved ${deb_count} .deb file(s)."
}

write_manifest() {
  local manifest="$OUTPUT_DIR/../DEBS.manifest"
  {
    echo "# Docker offline bundle for Ubuntu ${CODENAME} (${ARCH})"
    echo "# Collected: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "# Primary packages: ${DOCKER_APT_PACKAGES[*]}"
    echo ""
    find "$OUTPUT_DIR" -maxdepth 1 -name '*.deb' -printf '%f\n' | sort
  } >"$manifest"

  rm -f "$OUTPUT_DIR/../VERSION.docker"
  dpkg-deb -f "$OUTPUT_DIR"/docker-ce_*.deb Version 2>/dev/null \
    | awk '{print "docker-ce=" $0}' >>"$OUTPUT_DIR/../VERSION.docker" || true
  dpkg-deb -f "$OUTPUT_DIR"/docker-compose-plugin_*.deb Version 2>/dev/null \
    | awk '{print "docker-compose-plugin=" $0}' >>"$OUTPUT_DIR/../VERSION.docker" || true
}

write_readme() {
  cat >"$OUTPUT_DIR/../README.md" <<EOF
# packages/docker/

Offline Docker Engine + Compose v2 bundle for **Ubuntu 24.04 (${CODENAME}, ${ARCH})**.

| Path | Purpose |
|------|---------|
| \`debs/*.deb\` | Docker CE, CLI, containerd, buildx, compose plugin + dependencies |
| \`DEBS.manifest\` | List of included .deb filenames |
| \`VERSION.docker\` | Primary package versions (when available) |

Install on an air-gapped host:

\`\`\`bash
sudo scripts/install-docker-offline.sh
\`\`\`

Or let \`scripts/install-offline.sh\` install Docker automatically when missing.
EOF
}

main() {
  require_ubuntu_2404_build_host
  command -v apt-get >/dev/null 2>&1 || die "apt-get required"
  command -v apt-cache >/dev/null 2>&1 || die "apt-cache required"

  if ! docker_apt_repo_ready; then
    if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
      echo "[docker-debs] Elevating via sudo to configure Docker APT repository..."
      exec sudo -E bash "$0" "$@"
    fi
    echo "[docker-debs] Docker APT repository not configured; adding download.docker.com for ${CODENAME}..."
    setup_docker_apt_repo
  fi

  download_debs
  write_manifest
  write_readme
  echo "[docker-debs] Done: $OUTPUT_DIR"
}

main "$@"
