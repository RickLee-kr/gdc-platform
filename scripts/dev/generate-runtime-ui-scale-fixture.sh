#!/usr/bin/env bash
# Dev-only helper: generate a large operational snapshot JSON for manual Runtime UI validation.
# Does NOT modify the database. Output is a static fixture for browser/devtools inspection.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${ROOT}/scripts/dev/fixtures"
STREAM_COUNT="${1:-320}"
ROUTE_COUNT="${2:-120}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "${OUT_DIR}"

python3 - "${STREAM_COUNT}" "${ROUTE_COUNT}" "${OUT_DIR}" "${STAMP}" <<'PY'
import json
import sys
from datetime import datetime, timezone

stream_count = int(sys.argv[1])
route_count = int(sys.argv[2])
out_dir = sys.argv[3]
stamp = sys.argv[4]

def stream(i: int) -> dict:
    return {
        "stream_id": i,
        "stream_name": f"[DEV VALIDATION] Scale Stream {i}",
        "connector_id": 1,
        "source_id": 1,
        "enabled": True,
        "status": "RUNNING",
        "health_status": "ERROR" if i % 7 == 0 else "DEGRADED" if i % 5 == 0 else "HEALTHY",
        "eps_1m": i % 10,
        "eps_5m": i % 10,
        "success_rate_5m": 95,
        "failure_rate_5m": 5,
        "avg_latency_ms": 20,
        "route_count": 1,
        "healthy_route_count": 1,
        "failed_route_count": 0,
        "last_success_at": "2026-05-22T12:00:00Z",
        "last_error_at": None,
        "last_error_message": None,
        "checkpoint_updated_at": None,
        "checkpoint_lag_seconds": None,
    }

streams = [stream(i) for i in range(1, stream_count + 1)]
routes = [
    {
        "route_id": i,
        "stream_id": 1,
        "stream_name": streams[0]["stream_name"],
        "destination_id": 2,
        "destination_name": "[DEV VALIDATION] Scale Destination",
        "destination_type": "WEBHOOK_POST",
        "enabled": True,
        "failure_policy": "LOG_AND_CONTINUE",
        "health_status": "HEALTHY",
        "delivered_eps_1m": 1,
        "failed_eps_1m": 0,
        "success_rate_5m": 100,
        "retry_rate_5m": 0,
        "avg_latency_ms": 10,
        "last_success_at": "2026-05-22T12:00:00Z",
        "last_error_at": None,
        "last_error_message": None,
    }
    for i in range(1, route_count + 1)
]

snapshot = {
    "global": {
        "health_status": "HEALTHY",
        "total_streams": stream_count,
        "enabled_streams": stream_count,
        "running_streams": stream_count,
        "error_streams": 0,
        "total_routes": route_count,
        "enabled_routes": route_count,
        "total_destinations": 1,
        "enabled_destinations": 1,
        "total_eps_1m": stream_count,
        "total_eps_5m": stream_count,
        "avg_latency_ms": 20,
        "last_activity_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    },
    "streams": streams,
    "routes": routes,
    "destinations": [
        {
            "destination_id": 2,
            "destination_name": "[DEV VALIDATION] Scale Destination",
            "destination_type": "WEBHOOK_POST",
            "enabled": True,
            "health_status": "HEALTHY",
            "inbound_eps_1m": route_count,
            "failed_eps_1m": 0,
            "avg_latency_ms": 10,
            "route_count": route_count,
            "last_success_at": None,
            "last_error_at": None,
            "last_error_message": None,
        }
    ],
    "problems": [],
    "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
}

stream_path = f"{out_dir}/runtime-ui-{stream_count}-streams-{stamp}.json"
route_path = f"{out_dir}/runtime-ui-{route_count}-routes-{stamp}.json"
with open(stream_path, "w", encoding="utf-8") as fh:
    json.dump(snapshot, fh, indent=2)
with open(route_path, "w", encoding="utf-8") as fh:
    json.dump({**snapshot, "streams": streams[:1]}, fh, indent=2)

print(stream_path)
print(route_path)
PY

echo "Generated dev-only fixtures (no DB writes):"
echo "  streams fixture: ${OUT_DIR}/runtime-ui-${STREAM_COUNT}-streams-${STAMP}.json"
echo "  routes fixture:  ${OUT_DIR}/runtime-ui-${ROUTE_COUNT}-routes-${STAMP}.json"
echo
echo "Manual validation:"
echo "  1. Start dev platform with existing data intact."
echo "  2. Open Runtime Overview and Routes in Chrome."
echo "  3. Compare DOM node count and Network tab against pass/fail criteria in docs/performance/runtime-ui-virtualization-phase-6_5.md"
echo "  4. Optional debug logs: localStorage.setItem('GDC_RUNTIME_UI_DEBUG','1') then reload."
