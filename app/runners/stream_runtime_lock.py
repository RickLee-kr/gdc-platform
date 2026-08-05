"""Cross-process stream runtime ownership locks (same-host lab / multi-worker API).

Process-local ``threading.Lock`` cannot be observed by sibling uvicorn workers or a
standalone scheduler process. These advisory file locks make stop/delete wait until
the owning process releases runtime ownership.
"""

from __future__ import annotations

import fcntl
import logging
import os
import threading
from pathlib import Path
from typing import IO

logger = logging.getLogger(__name__)

_GUARD = threading.Lock()
_HANDLES: dict[tuple[str, int], IO[str]] = {}


def _lock_dir() -> Path:
    raw = (os.environ.get("GDC_STREAM_RUN_LOCK_DIR") or "").strip()
    if raw:
        path = Path(raw)
    else:
        path = Path(os.environ.get("TMPDIR") or "/tmp") / "gdc-stream-run-locks"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _lock_path(kind: str, stream_id: int) -> Path:
    return _lock_dir() / f"{kind}-{int(stream_id)}.lock"


def try_acquire(kind: str, stream_id: int) -> bool:
    """Non-blocking exclusive acquire. True when this process now owns the lock."""

    key = (str(kind), int(stream_id))
    with _GUARD:
        if key in _HANDLES:
            return False
        path = _lock_path(kind, stream_id)
        handle = path.open("a+", encoding="utf-8")
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            handle.close()
            return False
        handle.seek(0)
        handle.truncate()
        handle.write(f"pid={os.getpid()}\n")
        handle.flush()
        _HANDLES[key] = handle
        return True


def release(kind: str, stream_id: int) -> None:
    """Release a lock previously acquired by ``try_acquire`` in this process."""

    key = (str(kind), int(stream_id))
    with _GUARD:
        handle = _HANDLES.pop(key, None)
    if handle is None:
        return
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    finally:
        try:
            handle.close()
        except Exception:  # pragma: no cover - defensive
            logger.debug("stream_runtime_lock_close_failed kind=%s stream_id=%s", kind, stream_id)


def is_held(kind: str, stream_id: int) -> bool:
    """True when any process currently holds the exclusive lock (including this one)."""

    key = (str(kind), int(stream_id))
    with _GUARD:
        if key in _HANDLES:
            return True
    path = _lock_path(kind, stream_id)
    try:
        handle = path.open("a+", encoding="utf-8")
    except OSError:
        return False
    try:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        return False
    finally:
        handle.close()


def active_stream_ids(kind: str) -> list[int]:
    """Best-effort list of stream IDs with a lock file that is currently held."""

    root = _lock_dir()
    prefix = f"{kind}-"
    suffix = ".lock"
    out: list[int] = []
    try:
        names = list(root.iterdir())
    except OSError:
        return []
    for entry in names:
        name = entry.name
        if not (name.startswith(prefix) and name.endswith(suffix)):
            continue
        mid = name[len(prefix) : -len(suffix)]
        if not mid.isdigit():
            continue
        sid = int(mid)
        if is_held(kind, sid):
            out.append(sid)
    return sorted(out)
