"""Tests for scheduler container healthcheck (no pgrep)."""

from __future__ import annotations

from pathlib import Path

from app.scheduler.container_healthcheck import (
    STANDALONE_MODULE,
    main,
    scheduler_standalone_process_running,
)


def _write_cmdline(proc_dir: Path, pid: str, parts: list[bytes]) -> None:
    pid_dir = proc_dir / pid
    pid_dir.mkdir(parents=True)
    (pid_dir / "cmdline").write_bytes(b"\0".join(parts) + b"\0")


def test_detects_standalone_python_m_argv(tmp_path: Path) -> None:
    _write_cmdline(
        tmp_path,
        "7",
        [b"python", b"-m", STANDALONE_MODULE],
    )
    assert scheduler_standalone_process_running(tmp_path) is True


def test_ignores_healthcheck_module_process(tmp_path: Path) -> None:
    _write_cmdline(
        tmp_path,
        "99",
        [b"python", b"-m", b"app.scheduler.container_healthcheck"],
    )
    assert scheduler_standalone_process_running(tmp_path) is False


def test_ignores_shell_wrapper_without_python_m(tmp_path: Path) -> None:
    _write_cmdline(
        tmp_path,
        "1",
        [b"sh", b"-c", b"python -m app.scheduler.standalone"],
    )
    assert scheduler_standalone_process_running(tmp_path) is False


def test_ignores_unrelated_python(tmp_path: Path) -> None:
    _write_cmdline(tmp_path, "3", [b"python", b"-c", b"print(1)"])
    assert scheduler_standalone_process_running(tmp_path) is False


def test_main_exit_codes(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.scheduler.container_healthcheck.scheduler_standalone_process_running",
        lambda proc_root=None: True,
    )
    assert main() == 0
    monkeypatch.setattr(
        "app.scheduler.container_healthcheck.scheduler_standalone_process_running",
        lambda proc_root=None: False,
    )
    assert main() == 1
