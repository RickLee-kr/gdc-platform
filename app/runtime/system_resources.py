"""Local process/host resource snapshot for Runtime monitoring (lightweight)."""

from __future__ import annotations

import time
from dataclasses import dataclass

from app.runtime.schemas import RuntimeSystemResourcesResponse

try:
    import psutil
except ImportError:  # pragma: no cover - optional until dependency installed
    psutil = None  # type: ignore[assignment]

_net_prev_ts: float | None = None
_net_prev_in: int | None = None
_net_prev_out: int | None = None


@dataclass
class _DiskPick:
    mount: str


def _pick_root_disk() -> _DiskPick:
    return _DiskPick(mount="/")


def collect_runtime_system_resources() -> RuntimeSystemResourcesResponse:
    """CPU/memory/disk/network counters using psutil (falls back to zeros if unavailable)."""

    if psutil is None:
        return RuntimeSystemResourcesResponse(
            cpu_percent=0.0,
            memory_percent=0.0,
            memory_used_bytes=0,
            memory_total_bytes=0,
            disk_percent=0.0,
            disk_used_bytes=0,
            disk_total_bytes=0,
            network_in_bytes_per_sec=0.0,
            network_out_bytes_per_sec=0.0,
        )

    cpu_percent = float(psutil.cpu_percent(interval=0.05))
    vm = psutil.virtual_memory()
    mem_pct = float(vm.percent)
    mem_used = int(vm.used)
    mem_total = int(vm.total)

    disk = psutil.disk_usage(_pick_root_disk().mount)
    disk_pct = float(disk.percent) if disk.total > 0 else 0.0
    disk_used = int(disk.used)
    disk_total = int(disk.total)

    global _net_prev_ts, _net_prev_in, _net_prev_out
    now = time.monotonic()
    net = psutil.net_io_counters()
    cur_in = int(net.bytes_recv)
    cur_out = int(net.bytes_sent)
    in_per_sec = 0.0
    out_per_sec = 0.0
    if _net_prev_ts is not None and _net_prev_in is not None and _net_prev_out is not None:
        dt = now - _net_prev_ts
        if dt > 0:
            in_per_sec = max(0.0, (cur_in - _net_prev_in) / dt)
            out_per_sec = max(0.0, (cur_out - _net_prev_out) / dt)
    _net_prev_ts = now
    _net_prev_in = cur_in
    _net_prev_out = cur_out

    return RuntimeSystemResourcesResponse(
        cpu_percent=round(cpu_percent, 2),
        memory_percent=round(mem_pct, 2),
        memory_used_bytes=mem_used,
        memory_total_bytes=mem_total,
        disk_percent=round(disk_pct, 2),
        disk_used_bytes=disk_used,
        disk_total_bytes=disk_total,
        network_in_bytes_per_sec=round(in_per_sec, 2),
        network_out_bytes_per_sec=round(out_per_sec, 2),
    )
