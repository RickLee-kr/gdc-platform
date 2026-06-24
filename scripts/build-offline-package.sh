#!/usr/bin/env bash
# Build an air-gapped offline installation package for Data Relay (GDC Platform).
#
# Output (default):
#   offline-release/               — exploded package tree
#   offline-release-<version>.tar.gz — transport archive with SHA256SUMS
#
# Usage:
#   ./scripts/build-offline-package.sh
#   GDC_OFFLINE_SKIP_BUILD=1 ./scripts/build-offline-package.sh   # repackage only
#   GDC_OFFLINE_IMAGE_TAG=20260624 ./scripts/build-offline-package.sh
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OFFLINE_DIR="${GDC_OFFLINE_OUTPUT_DIR:-$ROOT/offline-release}"
IMAGE_TAG="${GDC_OFFLINE_IMAGE_TAG:-offline}"
VERSION="$(date -u +%Y%m%dT%H%M%SZ)"
if command -v git >/dev/null 2>&1 && git -C "$ROOT" rev-parse --short HEAD >/dev/null 2>&1; then
  VERSION="${VERSION}-$(git -C "$ROOT" rev-parse --short HEAD)"
fi
ARCHIVE_NAME="offline-release-${VERSION}.tar.gz"

die() { echo "ERROR: $*" >&2; exit 1; }

require_docker() {
  command -v docker >/dev/null 2>&1 || die "docker not found"
  docker compose version >/dev/null 2>&1 || die "docker compose plugin not found"
  docker info >/dev/null 2>&1 || die "docker daemon not reachable"
}

declare -a IMAGE_REFS=(
  "postgres:16-alpine"
  "gdc-platform-api:${IMAGE_TAG}"
  "gdc-platform-frontend:${IMAGE_TAG}"
  "gdc-platform-reverse-proxy:${IMAGE_TAG}"
)

build_images() {
  echo "[build] Building application images (api, frontend, reverse-proxy)..."
  docker compose -f docker-compose.platform.yml build api frontend reverse-proxy

  echo "[build] Tagging images as :${IMAGE_TAG} for offline compose..."
  docker tag gdc-platform-api "gdc-platform-api:${IMAGE_TAG}"
  docker tag gdc-platform-frontend "gdc-platform-frontend:${IMAGE_TAG}"
  docker tag gdc-platform-reverse-proxy "gdc-platform-reverse-proxy:${IMAGE_TAG}"

  echo "[build] Pulling postgres:16-alpine (if not present)..."
  docker pull postgres:16-alpine
}

stage_package_tree() {
  echo "[stage] Preparing $OFFLINE_DIR ..."
  rm -rf "$OFFLINE_DIR"
  mkdir -p \
    "$OFFLINE_DIR/images" \
    "$OFFLINE_DIR/packages/docker/debs" \
    "$OFFLINE_DIR/app" \
    "$OFFLINE_DIR/configs" \
    "$OFFLINE_DIR/scripts" \
    "$OFFLINE_DIR/checks" \
    "$OFFLINE_DIR/deploy/tls" \
    "$OFFLINE_DIR/deploy/backups"

  echo "[stage] Copying application source (backend, migrations, release scripts)..."
  mkdir -p "$OFFLINE_DIR/app/app" "$OFFLINE_DIR/app/alembic" "$OFFLINE_DIR/app/scripts/release"
  rsync -a \
    --exclude '__pycache__' \
    app/ "$OFFLINE_DIR/app/app/"
  rsync -a alembic/ "$OFFLINE_DIR/app/alembic/"
  cp alembic.ini requirements.txt "$OFFLINE_DIR/app/"
  if [[ -f frontend/package.json ]]; then
    cp frontend/package.json frontend/package-lock.json "$OFFLINE_DIR/packages/" 2>/dev/null || true
  fi

  mkdir -p "$OFFLINE_DIR/app/docker" "$OFFLINE_DIR/app/deploy" "$OFFLINE_DIR/app/scripts"
  rsync -a docker/ "$OFFLINE_DIR/app/docker/"
  rsync -a deploy/docker-compose.offline.yml "$OFFLINE_DIR/configs/"
  rsync -a deploy/docker-compose.https.yml "$OFFLINE_DIR/configs/" 2>/dev/null || true
  rsync -a scripts/release/ "$OFFLINE_DIR/app/scripts/release/"
  rsync -a scripts/offline/_common.sh "$OFFLINE_DIR/scripts/_common.sh"
  rsync -a scripts/offline/templates/.env.production.template "$OFFLINE_DIR/configs/.env.production.template"
  rsync -a scripts/offline/templates/images/ "$OFFLINE_DIR/images/"
  rsync -a scripts/offline/templates/scripts/ "$OFFLINE_DIR/scripts/"
  rsync -a scripts/offline/templates/checks/ "$OFFLINE_DIR/checks/"

  cp docker-compose.platform.yml "$OFFLINE_DIR/configs/docker-compose.platform.yml.reference"

  cat >"$OFFLINE_DIR/packages/README.md" <<'EOF'
# packages/

| Path | Purpose |
|------|---------|
| `docker/debs/*.deb` | Docker Engine + Compose v2 offline bundle (Ubuntu 24.04) |
| `docker/DEBS.manifest` | List of bundled .deb filenames |
| `package-lock.json` | Frontend dependency reference (baked into images) |

Runtime Python dependencies are in the pre-built `gdc-platform-api:offline` image.
EOF

  if [[ "${GDC_OFFLINE_SKIP_DOCKER_DEBS:-0}" != "1" ]]; then
    echo "[stage] Collecting Docker .deb bundle (Ubuntu 24.04)..."
    bash "$ROOT/scripts/offline/collect-docker-debs.sh" "$OFFLINE_DIR/packages/docker/debs"
  else
    echo "[stage] Skipping Docker .deb collection (GDC_OFFLINE_SKIP_DOCKER_DEBS=1)"
  fi

  cat >"$OFFLINE_DIR/VERSION" <<EOF
version=${VERSION}
image_tag=${IMAGE_TAG}
built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
built_on=$(hostname 2>/dev/null || echo unknown)
git_commit=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)
EOF

  if [[ -f "$ROOT/scripts/offline/templates/README-OFFLINE-INSTALL.md" ]]; then
    cp "$ROOT/scripts/offline/templates/README-OFFLINE-INSTALL.md" "$OFFLINE_DIR/README-OFFLINE-INSTALL.md"
  fi
}

export_images() {
  echo "[export] Saving Docker images to $OFFLINE_DIR/images ..."
  : >"$OFFLINE_DIR/images/IMAGES.manifest"
  local ref base
  for ref in "${IMAGE_REFS[@]}"; do
    docker image inspect "$ref" >/dev/null 2>&1 || die "Image not found locally: $ref (run build step first)"
    base="${ref//[:\/]/_}"
    echo "[export]   $ref -> ${base}.tar"
    docker save -o "$OFFLINE_DIR/images/${base}.tar" "$ref"
    echo "$ref" >>"$OFFLINE_DIR/images/IMAGES.manifest"
  done
}

write_checksums() {
  echo "[checksum] Writing SHA256SUMS..."
  (
    cd "$OFFLINE_DIR"
    find . -type f ! -name 'SHA256SUMS' -print0 | sort -z | xargs -0 sha256sum
  ) >"$OFFLINE_DIR/SHA256SUMS"
}

create_archive() {
  echo "[archive] Creating $ARCHIVE_NAME ..."
  tar -C "$(dirname "$OFFLINE_DIR")" -czf "$ROOT/$ARCHIVE_NAME" "$(basename "$OFFLINE_DIR")"
  sha256sum "$ROOT/$ARCHIVE_NAME" >"$ROOT/${ARCHIVE_NAME}.sha256"
}

chmod_scripts() {
  chmod +x \
    "$OFFLINE_DIR/images/load-images.sh" \
    "$OFFLINE_DIR/images/verify-images.sh" \
    "$OFFLINE_DIR/scripts/"*.sh \
    "$OFFLINE_DIR/checks/"*.sh 2>/dev/null || true
}

main() {
  require_docker

  if [[ "${GDC_OFFLINE_SKIP_BUILD:-0}" != "1" ]]; then
    build_images
  else
    echo "[build] Skipping image build (GDC_OFFLINE_SKIP_BUILD=1)"
    for ref in "${IMAGE_REFS[@]}"; do
      docker image inspect "$ref" >/dev/null 2>&1 || die "Missing image for repackage: $ref"
    done
  fi

  stage_package_tree
  export_images
  chmod_scripts
  write_checksums
  create_archive

  echo ""
  echo "============================================================"
  echo "Offline package ready"
  echo "============================================================"
  echo "Directory:  $OFFLINE_DIR"
  echo "Archive:    $ROOT/$ARCHIVE_NAME"
  echo "Checksum:   $ROOT/${ARCHIVE_NAME}.sha256"
  echo "Images:     ${#IMAGE_REFS[@]} (see images/IMAGES.manifest)"
  echo ""
  echo "Transfer ${ARCHIVE_NAME} to the air-gapped host, extract, then:"
  echo "  cd offline-release"
  echo "  sudo scripts/install-docker-offline.sh   # when Docker is not installed"
  echo "  scripts/reset-production-data.sh         # optional wipe"
  echo "  scripts/install-offline.sh"
  echo "  checks/verify-install.sh"
}

main "$@"
