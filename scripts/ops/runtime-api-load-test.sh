#!/usr/bin/env bash
# Runtime KPI API load test with cold/warm cache timing.
# Usage:
#   export GDC_API_TOKEN=$(docker exec gdc-platform-api python -c "...")
#   ./scripts/ops/runtime-api-load-test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

API_BASE="${GDC_API_BASE:-http://127.0.0.1:8000}"
API_PREFIX="${API_PREFIX:-/api/v1}"
ITERATIONS="${GDC_LOAD_ITERATIONS:-120}"
STREAM_ID="${GDC_LOAD_STREAM_ID:-1}"
ROUTE_ID="${GDC_LOAD_ROUTE_ID:-1}"

if [[ -z "${GDC_API_TOKEN:-}" ]]; then
  echo "GDC_API_TOKEN is required" >&2
  exit 1
fi

auth_header=(-H "Authorization: Bearer ${GDC_API_TOKEN}")

endpoints=(
  "GET|${API_PREFIX}/runtime/dashboard/summary?window=1h"
  "GET|${API_PREFIX}/runtime/dashboard/summary?window=30d"
  "GET|${API_PREFIX}/runtime/health/overview"
  "GET|${API_PREFIX}/runtime/observability/summary?window=15m"
  "GET|${API_PREFIX}/runtime/streams/${STREAM_ID}/stats-health?window=1h"
  "GET|${API_PREFIX}/runtime/streams/${STREAM_ID}/metrics?window=1h"
  "GET|${API_PREFIX}/runtime/health/routes/${ROUTE_ID}"
  "GET|${API_PREFIX}/runtime/health/destinations"
  "GET|${API_PREFIX}/routes/"
  "GET|${API_PREFIX}/streams/"
)

percentile() {
  local p="$1"
  shift
  python3 - "$p" "$@" <<'PY'
import sys
vals = sorted(float(x) for x in sys.argv[2:] if x)
if not vals:
    print("0")
    sys.exit(0)
p = float(sys.argv[1])
idx = max(0, min(len(vals) - 1, int(round((p / 100.0) * (len(vals) - 1)))))
print(f"{vals[idx]:.1f}")
PY
}

run_phase() {
  local phase="$1"
  local cache_bust="${2:-}"
  echo ""
  echo "=== Phase: ${phase} (${ITERATIONS} iterations each) ==="
  printf "%-60s %8s %8s %8s %8s %6s\n" "endpoint" "mean_ms" "p50_ms" "p95_ms" "max_ms" "errors"
  printf "%-60s %8s %8s %8s %8s %6s\n" "--------" "-------" "------" "------" "------" "------"

  for entry in "${endpoints[@]}"; do
    IFS='|' read -r method path <<<"$entry"
    local url="${API_BASE}${path}"
    if [[ -n "$cache_bust" ]]; then
      if [[ "$url" == *"?"* ]]; then
        url="${url}&_cb=${cache_bust}"
      else
        url="${url}?_cb=${cache_bust}"
      fi
    fi
    local times=()
    local errors=0
    for ((i = 1; i <= ITERATIONS; i++)); do
      local start end elapsed http_code
      start=$(date +%s%3N)
      http_code=$(curl -s -o /dev/null -w "%{http_code}" "${auth_header[@]}" -X "$method" "$url" || echo "000")
      end=$(date +%s%3N)
      elapsed=$((end - start))
      if [[ "$http_code" != "200" ]]; then
        errors=$((errors + 1))
      fi
      times+=("$elapsed")
    done
    local mean p50 p95 max
    mean=$(python3 - "${times[@]}" <<'PY'
import sys
vals=[float(x) for x in sys.argv[1:]]
print(f"{sum(vals)/len(vals):.1f}" if vals else "0")
PY
)
    p50=$(percentile 50 "${times[@]}")
    p95=$(percentile 95 "${times[@]}")
    max=$(python3 - "${times[@]}" <<'PY'
import sys
vals=[float(x) for x in sys.argv[1:]]
print(f"{max(vals):.1f}" if vals else "0")
PY
)
    printf "%-60s %8s %8s %8s %8s %6s\n" "$path" "$mean" "$p50" "$p95" "$max" "$errors"
  done
}

echo "Runtime API load test"
echo "API_BASE=${API_BASE} ITERATIONS=${ITERATIONS} STREAM_ID=${STREAM_ID} ROUTE_ID=${ROUTE_ID}"

run_phase "COLD (cache-bust query param)" "$(date +%s)"
run_phase "WARM (stable URLs)" ""
