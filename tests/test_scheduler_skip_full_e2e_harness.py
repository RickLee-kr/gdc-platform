"""Scheduler must not poll [FULL E2E] harness streams (run-once / webhook ownership)."""

from __future__ import annotations

from app.dev_validation_lab.runtime_gates import (
    is_run_once_harness_stream,
    stream_name_is_full_e2e_harness,
)


def test_full_e2e_prefix_is_harness_owned() -> None:
    assert stream_name_is_full_e2e_harness("[FULL E2E]xp-5093f0dda07b-stream")
    assert is_run_once_harness_stream("[FULL E2E]xp-5093f0dda07b-stream")


def test_dev_validation_streams_are_not_harness_owned() -> None:
    assert not is_run_once_harness_stream("[DEV VALIDATION] something")
    assert not is_run_once_harness_stream("[DEV E2E] something")
    assert not is_run_once_harness_stream("prod-stream")


def test_scheduler_loop_skips_full_e2e_without_run(monkeypatch) -> None:
    from app.scheduler.scheduler import Scheduler

    calls: list[int] = []

    class _FakeRunner:
        def run(self, *_a, **_k):
            calls.append(1)
            return {"outcome": "completed"}

    sched = Scheduler(streams_provider=lambda: [])
    monkeypatch.setattr(sched, "_runner_for_current_thread", lambda: _FakeRunner())

    # Gate returns enabled FULL E2E stream — loop must exit without calling run.
    monkeypatch.setattr(
        "app.scheduler.scheduler.run_with_db",
        lambda fn: {
            "enabled": True,
            "polling_interval": 1.0,
            "name": "[FULL E2E]xp-test-stream",
        },
    )
    sched._stop_event.set()  # ensure we don't wait forever if logic regresses
    # Clear stop so the loop body runs once; re-set via gate break path.
    sched._stop_event.clear()

    # Force single iteration: after skip break, loop ends.
    sched._loop_stream(99999)
    assert calls == []
