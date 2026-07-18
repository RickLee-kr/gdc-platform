"""Container healthcheck for the standalone scheduler process.

Avoids ``pgrep`` / ``procps``. Scans ``/proc/*/cmdline`` for the real
``python -m app.scheduler.standalone`` argv form so a mere container
alive check is not enough and the healthcheck process itself does not
match (it uses ``-m app.scheduler.container_healthcheck``).
"""

from __future__ import annotations

import pathlib
import sys

STANDALONE_MODULE = b"app.scheduler.standalone"


def scheduler_standalone_process_running(proc_root: pathlib.Path | None = None) -> bool:
    """Return True when a live process was started as ``python -m app.scheduler.standalone``."""

    root = proc_root or pathlib.Path("/proc")
    try:
        entries = list(root.iterdir())
    except OSError:
        return False

    for entry in entries:
        if not entry.name.isdigit():
            continue
        cmdline_path = entry / "cmdline"
        try:
            raw = cmdline_path.read_bytes()
        except OSError:
            continue
        if not raw:
            continue
        parts = raw.split(b"\0")
        if b"-m" in parts and STANDALONE_MODULE in parts:
            return True
    return False


def main() -> int:
    return 0 if scheduler_standalone_process_running() else 1


if __name__ == "__main__":
    raise SystemExit(main())
