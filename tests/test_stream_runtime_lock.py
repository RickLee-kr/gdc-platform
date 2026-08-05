"""Unit tests for cross-process stream runtime locks."""

from __future__ import annotations

import multiprocessing as mp

import pytest

from app.runners import stream_runtime_lock


def _child_hold(kind: str, stream_id: int, ready: mp.Event, release: mp.Event) -> None:
    assert stream_runtime_lock.try_acquire(kind, stream_id)
    ready.set()
    release.wait(timeout=30)
    stream_runtime_lock.release(kind, stream_id)


def test_flock_visible_across_processes(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GDC_STREAM_RUN_LOCK_DIR", str(tmp_path))
    ready = mp.Event()
    release = mp.Event()
    proc = mp.Process(target=_child_hold, args=("run", 99, ready, release))
    proc.start()
    try:
        assert ready.wait(timeout=10)
        assert stream_runtime_lock.is_held("run", 99)
        assert not stream_runtime_lock.try_acquire("run", 99)
    finally:
        release.set()
        proc.join(timeout=10)
        assert proc.exitcode == 0
    assert not stream_runtime_lock.is_held("run", 99)
