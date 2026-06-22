#!/usr/bin/env bash
# Add 8GiB swap for GDC platform host (requires sudo). Idempotent.
set -euo pipefail
SWAPFILE=/swapfile-gdc
SIZE_GB="${1:-8}"

if swapon --show | grep -q "$SWAPFILE"; then
  echo "Already active: $SWAPFILE"
  swapon --show
  exit 0
fi

if [[ ! -f "$SWAPFILE" ]]; then
  echo "Creating ${SIZE_GB}G swap file at $SWAPFILE ..."
  sudo fallocate -l "${SIZE_GB}G" "$SWAPFILE" || sudo dd if=/dev/zero of="$SWAPFILE" bs=1M count=$((SIZE_GB * 1024)) status=progress
  sudo chmod 600 "$SWAPFILE"
  sudo mkswap "$SWAPFILE"
fi

sudo swapon "$SWAPFILE"
echo "Swap added:"
swapon --show
free -h
