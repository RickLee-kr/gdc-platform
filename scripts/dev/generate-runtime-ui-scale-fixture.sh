#!/usr/bin/env bash
# Dev-only helper: generate operational snapshot JSON fixtures for Runtime UI virtualization validation.
# Does NOT modify the database. Writes static files under frontend/public/dev-fixtures/ (served by Vite).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PUBLIC_DIR="${ROOT}/frontend/public/dev-fixtures"
ARCHIVE_DIR="${ROOT}/scripts/dev/fixtures"
STREAM_COUNT="${1:-320}"
ROUTE_COUNT="${2:-120}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STABLE_NAME="runtime-operational-snapshot-${STREAM_COUNT}x${ROUTE_COUNT}.json"

mkdir -p "${PUBLIC_DIR}" "${ARCHIVE_DIR}"

python3 - "${STREAM_COUNT}" "${ROUTE_COUNT}" "${PUBLIC_DIR}" "${ARCHIVE_DIR}" "${STABLE_NAME}" "${STAMP}" <<'PY'
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

stream_count = int(sys.argv[1])
route_count = int(sys.argv[2])
public_dir = Path(sys.argv[3])
archive_dir = Path(sys.argv[4])
stable_name = sys.argv[5]
stamp = sys.argv[6]

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
        "error_streams": sum(1 for s in streams if s["health_status"] == "ERROR"),
        "total_routes": route_count,
        "enabled_routes": route_count,
        "total_destinations": 1,
        "enabled_destinations": 1,
        "total_eps_1m": float(stream_count),
        "total_eps_5m": float(stream_count),
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

stable_public = public_dir / stable_name
stamped_public = public_dir / f"runtime-ui-{stream_count}x{route_count}-{stamp}.json"
stamped_archive = archive_dir / stamped_public.name

for path in (stable_public, stamped_public, stamped_archive):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")

manifest = {
    "default": stable_name,
    "fixtures": sorted(p.name for p in public_dir.glob("runtime-operational-snapshot-*.json")),
}
(public_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
(public_dir / "README.md").write_text(
    "# Dev operational snapshot fixtures\n\n"
    "Static JSON matching `OperationalSnapshotResponse` for Phase 6.5 browser validation.\n\n"
    "Enable in the app (DEV only):\n\n"
    "```js\n"
    "localStorage.setItem('GDC_RUNTIME_FIXTURE_MODE', '1')\n"
    "localStorage.setItem('GDC_RUNTIME_FIXTURE_FILE', 'runtime-operational-snapshot-320x120.json')\n"
    "location.reload()\n"
    "```\n\n"
    "Or use the Runtime fixture mode banner on Runtime Overview / Routes.\n",
    encoding="utf-8",
)
print(stable_public)
print(stamped_public)
PY

echo "Generated dev fixtures (no DB writes):"
echo "  public (Vite): ${PUBLIC_DIR}/${STABLE_NAME}"
echo "  manifest:      ${PUBLIC_DIR}/manifest.json"
echo
echo "Enable fixture mode:"
echo "  localStorage.setItem('GDC_RUNTIME_FIXTURE_MODE','1')"
echo "  localStorage.setItem('GDC_RUNTIME_FIXTURE_FILE','${STABLE_NAME}')"
echo "  location.reload()"
echo
echo "Or open Runtime Overview with:"
echo "  ?runtime_fixture=1&runtime_fixture_file=${STABLE_NAME}"
