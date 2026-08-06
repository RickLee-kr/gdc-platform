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


def test_cleanup_unowned_lock_files_removes_orphans_only(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GDC_STREAM_RUN_LOCK_DIR", str(tmp_path))
    orphan = tmp_path / "run-7.lock"
    orphan.write_text("pid=1\n", encoding="utf-8")
    assert stream_runtime_lock.try_acquire("run", 8)
    try:
        held = tmp_path / "run-8.lock"
        assert held.exists()
        removed = stream_runtime_lock.cleanup_unowned_lock_files()
        assert removed >= 1
        assert not orphan.exists()
        assert held.exists()
        assert stream_runtime_lock.is_held("run", 8)
    finally:
        stream_runtime_lock.release("run", 8)
    assert stream_runtime_lock.cleanup_unowned_lock_files() >= 1
    assert not (tmp_path / "run-8.lock").exists()


def test_release_all_held_clears_process_local_handles(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GDC_STREAM_RUN_LOCK_DIR", str(tmp_path))
    assert stream_runtime_lock.try_acquire("run", 11)
    assert stream_runtime_lock.try_acquire("worker", 12)
    assert stream_runtime_lock.release_all_held() == 2
    assert not stream_runtime_lock.is_held("run", 11)
    assert not stream_runtime_lock.is_held("worker", 12)
    assert stream_runtime_lock.try_acquire("run", 11)
    stream_runtime_lock.release("run", 11)

