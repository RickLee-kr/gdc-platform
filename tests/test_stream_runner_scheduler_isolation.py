"""M6.1 — StreamRunner must not share mutable run state across scheduler workers."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import Session

from app.runners.stream_runner import StreamRunner
from tests.test_stream_runner_e2e import _FakePoller, _FakeWebhookSender, _build_runner, _seed_stream_runtime
from app.runners.stream_loader import load_stream_context


def test_persist_delivery_log_uses_db_snapshot_not_late_active_db() -> None:
    """Regression: finally on another thread must not clear db before db.add."""

    runner = StreamRunner()
    db = MagicMock()
    runner._active_db = db
    runner._run_id = "run-1"
    runner._connector_id = 1

    with patch("app.runners.stream_runner.DeliveryLog") as row_cls:
        row_cls.return_value = MagicMock()
        runner._persist_delivery_log(
            {
                "stage": "protection_complete",
                "stream_id": 1,
                "message": "protection complete",
                "processing_time_ms": 5,
                "latency_ms": 5,
            }
        )
        db.add.assert_called_once()
        runner._active_db = None
        db.add.reset_mock()
        # Snapshot already taken; a second persist after clear should no-op
        runner._persist_delivery_log({"stage": "run_started", "stream_id": 1, "message": "x"})
        db.add.assert_not_called()


def test_scheduler_run_stream_uses_db_session(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.scheduler.scheduler import Scheduler

    db = db_session
    fixture = _seed_stream_runtime(db)
    stream_id = fixture["stream_id"]
    ctx = load_stream_context(db, stream_id)

    seen_db: list[bool] = []

    class _CapturingRunner(StreamRunner):
        def run(self, stream: Any, db: Session | None = None) -> dict[str, Any]:
            seen_db.append(db is not None)
            poller = _FakePoller(response={"items": []})
            inner = _build_runner(poller=poller, webhook_sender=_FakeWebhookSender())
            return inner.run(stream, db=db)

    monkeypatch.setattr("app.scheduler.scheduler.StreamRunner", _CapturingRunner)
    sched = Scheduler()
    sched.run_stream(ctx)
    assert seen_db == [True]


def test_scheduler_worker_loop_uses_fresh_runner_per_cycle(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.scheduler import scheduler as sched_mod

    db = db_session
    fixture = _seed_stream_runtime(db)
    stream_id = fixture["stream_id"]
    created: list[StreamRunner] = []

    class _TrackingRunner(StreamRunner):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, **kwargs)
            created.append(self)

        def run(self, stream: Any, db: Session | None = None) -> dict[str, Any]:
            poller = _FakePoller(response={"items": []})
            inner = _build_runner(poller=poller, webhook_sender=_FakeWebhookSender())
            return inner.run(stream, db=db)

    monkeypatch.setattr(sched_mod, "StreamRunner", _TrackingRunner)
    monkeypatch.setattr(sched_mod, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(sched_mod, "get_stream_by_id", lambda _db, sid: type("R", (), {"enabled": False, "polling_interval": 60})())
    sched = sched_mod.Scheduler()
    sched._loop_stream(stream_id)
    assert len(created) == 1
