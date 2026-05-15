#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
if [[ "${1:-}" == "--volumes" ]]; then
  if [[ "${CONFIRM:-}" != "1" ]]; then
    echo "Refusing: set CONFIRM=1 to drop compose volumes (destructive)."
    exit 2
  fi
  docker compose -f docker-compose.source-expansion-test.yml --project-name gdc_source_expansion_test down -v
else
  docker compose -f docker-compose.source-expansion-test.yml --project-name gdc_source_expansion_test down
fi
