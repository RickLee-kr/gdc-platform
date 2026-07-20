#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
E2E="$(cd "$ROOT/.." && pwd)"
cd "$E2E"
if [[ ! -d node_modules ]]; then
  npm install
fi
exec npx tsx "$ROOT/suite-validation-gate.ts" "$@"
