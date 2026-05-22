#!/usr/bin/env bash
# Canonical one-command development platform bootstrap (delegates to bootstrap-dev-platform.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec "$ROOT/scripts/dev/bootstrap-dev-platform.sh" "$@"
