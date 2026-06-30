#!/usr/bin/env bash
# Start continuous lab throughput feeder (foreground). Requires platform API + fixtures.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export PYTHONPATH="$ROOT"
export LAB_THROUGHPUT_API_BASE_URL="${LAB_THROUGHPUT_API_BASE_URL:-http://127.0.0.1:8000}"
exec python3 -m app.dev_validation_lab.lab_throughput_feeder "$@"
