#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGES_DIR="$SCRIPT_DIR/images"
MANIFEST="$SCRIPT_DIR/checksums/IMAGES.manifest"

die() { echo "ERROR: $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker command not found."
docker info >/dev/null 2>&1 || die "docker daemon is not reachable."
[[ -f "$MANIFEST" ]] || die "Missing manifest: $MANIFEST"
[[ -d "$IMAGES_DIR" ]] || die "Missing images directory: $IMAGES_DIR"

echo "[load] Loading image archives from $IMAGES_DIR ..."
shopt -s nullglob
archives=("$IMAGES_DIR"/*.tar)
[[ "${#archives[@]}" -gt 0 ]] || die "No image tar files found in $IMAGES_DIR"

for archive in "${archives[@]}"; do
  echo "  - docker load -i $(basename "$archive")"
  docker load -i "$archive" >/dev/null
done

missing=0
while IFS= read -r ref || [[ -n "$ref" ]]; do
  ref="${ref%%#*}"
  ref="$(echo "$ref" | xargs)"
  [[ -n "$ref" ]] || continue
  if docker image inspect "$ref" >/dev/null 2>&1; then
    echo "OK   $ref"
  else
    echo "MISS $ref"
    missing=$((missing + 1))
  fi
done <"$MANIFEST"

[[ "$missing" -eq 0 ]] || die "Image manifest verification failed (${missing} missing)."
echo "[load] Image load and manifest verification complete."
