#!/usr/bin/env bash
# Load all Docker images shipped in the offline package (no registry access required).
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGES_DIR="$SCRIPT_DIR"

die() { echo "ERROR: $*" >&2; exit 1; }

if ! command -v docker >/dev/null 2>&1; then
  die "docker is not installed. Install Docker Engine + Compose plugin before loading images."
fi

shopt -s nullglob
tarballs=("$IMAGES_DIR"/*.tar)
if [[ "${#tarballs[@]}" -eq 0 ]]; then
  die "No image tarballs found in $IMAGES_DIR"
fi

echo "[$(date '+%F %T')] Loading ${#tarballs[@]} Docker image archive(s) from $IMAGES_DIR"
for archive in "${tarballs[@]}"; do
  echo "  -> docker load -i $(basename "$archive")"
  docker load -i "$archive"
done

if [[ -x "$SCRIPT_DIR/verify-images.sh" ]]; then
  echo ""
  "$SCRIPT_DIR/verify-images.sh"
else
  echo "WARN: verify-images.sh not found; skipping image manifest check." >&2
fi

echo ""
echo "Image load complete."
