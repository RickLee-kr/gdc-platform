"""M6.1 — schema observation uses stable DB reference during stream runs."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from app.runners.stream_runner import StreamRunner
from tests.test_stream_runner_e2e import _FakePoller, _FakeWebhookSender, _build_runner, _seed_stream_runtime
from app.runners.stream_loader import load_stream_context


def test_observe_extracted_event_schema_skips_when_db_none() -> None:
    runner = StreamRunner()
    runner._active_db = None
    with patch("app.schema_observation.service.observe_extracted_events") as obs:
        runner._observe_extracted_event_schema(stream_id=1, events=[{"a": 1}])
        obs.assert_not_called()


def test_observe_extracted_event_schema_calls_with_captured_db(db_session: Session) -> None:
    db = db_session
    fixture = _seed_stream_runtime(db)
    stream_id = fixture["stream_id"]
    runner = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "1", "message": "x", "vendor": "v"}]}),
        webhook_sender=_FakeWebhookSender(),
    )
    ctx = load_stream_context(db, stream_id)

    with patch("app.schema_observation.service.observe_extracted_events") as obs:
        runner.run(ctx, db=db)
        assert obs.called
        session_arg = obs.call_args[0][0]
        assert session_arg is not None
        assert hasattr(session_arg, "add")


def test_observe_failure_does_not_break_run(db_session: Session) -> None:
    db = db_session
    fixture = _seed_stream_runtime(db)
    stream_id = fixture["stream_id"]
    runner = _build_runner(
        poller=_FakePoller(response={"items": [{"id": "1", "message": "x", "vendor": "v"}]}),
        webhook_sender=_FakeWebhookSender(),
    )
    ctx = load_stream_context(db, stream_id)

    with patch(
        "app.schema_observation.service.observe_extracted_events",
        side_effect=RuntimeError("observation boom"),
    ):
        summary = runner.run(ctx, db=db)
    assert summary.get("outcome") in ("completed", "no_events", "skipped_lock")
