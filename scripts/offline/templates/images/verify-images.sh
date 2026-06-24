#!/usr/bin/env bash
# Verify every image listed in IMAGES.manifest is present locally after docker load.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$SCRIPT_DIR/IMAGES.manifest"

die() { echo "ERROR: $*" >&2; exit 1; }

[[ -f "$MANIFEST" ]] || die "Manifest not found: $MANIFEST"

missing=()
while IFS= read -r ref || [[ -n "$ref" ]]; do
  ref="${ref%%#*}"
  ref="$(echo "$ref" | xargs)"
  [[ -n "$ref" ]] || continue
  if docker image inspect "$ref" >/dev/null 2>&1; then
    echo "OK   $ref"
  else
    echo "MISS $ref"
    missing+=("$ref")
  fi
done <"$MANIFEST"

if [[ "${#missing[@]}" -gt 0 ]]; then
  echo ""
  die "Missing ${#missing[@]} required image(s). Re-run load-images.sh or rebuild the offline package."
fi

echo ""
echo "All $(grep -cve '^[[:space:]]*$' -e '^[[:space:]]*#' "$MANIFEST") image(s) present."
