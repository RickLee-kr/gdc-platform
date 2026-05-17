#!/usr/bin/env bash
# Unified platform install/bootstrap entry point for clean Ubuntu hosts.
# Delegates to scripts/release/install.sh (Docker install, .env bootstrap, migrations, admin seed).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$ROOT/scripts/release/install.sh" "$@"
