"""Unit tests for scheduler transient-error backoff helpers."""

from __future__ import annotations

import errno

import pytest

from app.scheduler.scheduler import compute_scheduler_backoff_wait_sec, is_transient_scheduler_error


@pytest.mark.parametrize(
    ("failures", "interval", "expected"),
    [
        (0, 60.0, 60.0),
        (1, 60.0, 120.0),
        (2, 60.0, 240.0),
        (3, 60.0, 300.0),  # capped
        (5, 60.0, 300.0),
        (6, 60.0, 300.0),  # exponent capped at 5 before min(300, ...)
        (1, 10.0, 20.0),
        (2, 10.0, 40.0),
    ],
)
def test_compute_scheduler_backoff_wait_sec(failures: int, interval: float, expected: float) -> None:
    assert compute_scheduler_backoff_wait_sec(interval=interval, consecutive_failures=failures) == expected


def test_is_transient_scheduler_error_types() -> None:
    assert is_transient_scheduler_error(BrokenPipeError("broken pipe"))
    assert is_transient_scheduler_error(ConnectionError("connection refused"))
    assert is_transient_scheduler_error(TimeoutError("timed out"))
    assert is_transient_scheduler_error(OSError(errno.EPIPE, "Broken pipe"))
    assert is_transient_scheduler_error(OSError(32, "Broken pipe"))
    assert is_transient_scheduler_error(RuntimeError("Connection refused by peer"))
    assert is_transient_scheduler_error(RuntimeError("request timed out"))
    assert not is_transient_scheduler_error(ValueError("stream disabled"))
    assert not is_transient_scheduler_error(RuntimeError("mapping invalid"))
