"""StreamRunner E2E tests for the generic incremental fetch framework."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.runners.stream_loader import load_stream_context
from app.runners.stream_runner import StreamRunner
from app.streams.models import Stream
from tests.test_stream_dedup_runtime import _enable_dedup
from tests.test_stream_runner_e2e import (
    _FakePoller,
    _FakeWebhookSender,
    _build_runner,
    _checkpoint_value,
    _seed_stream_runtime,
)


def _enable_incremental_fetch(
    db: Session,
    stream_id: int,
    *,
    strategy: str,
    watermark_field: str | None = None,
    cursor_field: str | None = None,
    stability_lag_seconds: int | None = None,
    initial_lookback_seconds: int | None = None,
) -> None:
    row = db.query(Stream).filter(Stream.id == stream_id).one()
    cfg = dict(row.config_json or {})
    inc: dict[str, object] = {"strategy": strategy}
    if watermark_field:
        inc["watermark_field"] = watermark_field
    if cursor_field:
        inc["cursor_field"] = cursor_field
    if stability_lag_seconds is not None:
        inc["stability_lag_seconds"] = stability_lag_seconds
    if initial_lookback_seconds is not None:
        inc["initial_lookback_seconds"] = initial_lookback_seconds
    cfg["incremental_fetch"] = inc
    row.config_json = cfg
    db.add(row)
    db.commit()


def _set_checkpoint(db: Session, stream_id: int, value: dict[str, object]) -> None:
    row = db.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).one()
    row.checkpoint_value_json = value
    db.add(row)
    db.commit()


def test_cursor_strategy_fetch_delivery_checkpoint_and_replay(db_session: Session) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    _enable_incremental_fetch(db_session, stream_id, strategy="cursor", cursor_field="$.id")
    _set_checkpoint(db_session, stream_id, {"connector_cursor": "evt-0"})

    poller = _FakePoller(
        response={"items": [{"id": "evt-1", "message": "one"}, {"id": "evt-2", "message": "two"}]}
    )
    runner = _build_runner(poller=poller, webhook_sender=_FakeWebhookSender())
    summary = runner.run(load_stream_context(db_session, stream_id), db=db_session)

    after = _checkpoint_value(db_session, stream_id)
    assert after["connector_cursor"] == "evt-2"
    assert after["delivery_checkpoint"]["last_success_event"]["event_id"] == "evt-2"
    assert summary.get("checkpoint_updated") is True
    runtime_summary = summary.get("incremental_runtime_summary") or {}
    assert runtime_summary.get("strategy") == "cursor"
    assert runtime_summary.get("delivered") >= 1

    context = load_stream_context(db_session, stream_id)
    context.replay_start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    context.replay_end = datetime(2026, 1, 2, tzinfo=timezone.utc)
    context.dry_run = True
    replay_summary = runner.run(context, db=db_session)
    replay_runtime = replay_summary.get("incremental_runtime_summary") or {}
    assert replay_runtime.get("replayed") is True


def test_timestamp_watermark_advances_fetch_and_preserves_on_delivery_failure(db_session: Session) -> None:
    fixture = _seed_stream_runtime(db_session, failure_policies=["STOP_ON_FAILURE"])
    stream_id = int(fixture["stream_id"])
    _enable_incremental_fetch(
        db_session,
        stream_id,
        strategy="timestamp_watermark",
        watermark_field="$.ts",
    )
    _set_checkpoint(
        db_session,
        stream_id,
        {"incremental_fetch_watermark": "2026-01-01T00:00:00Z"},
    )

    poller = _FakePoller(
        response={
            "items": [
                {"id": "evt-a", "message": "a", "ts": "2026-01-02T10:00:00Z"},
                {"id": "evt-b", "message": "b", "ts": "2026-01-02T11:00:00Z"},
            ]
        }
    )
    sender = _FakeWebhookSender(fail_urls={"https://receiver-0.example.com/events"})
    before = _checkpoint_value(db_session, stream_id)
    summary = _build_runner(poller=poller, webhook_sender=sender).run(
        load_stream_context(db_session, stream_id),
        db=db_session,
    )
    after = _checkpoint_value(db_session, stream_id)

    assert summary.get("checkpoint_updated") is False
    assert after["incremental_fetch_watermark"] == "2026-01-02T11:00:00Z"
    assert before.get("delivery_checkpoint") in (None, {})
    assert after.get("delivery_checkpoint", {}) == before.get("delivery_checkpoint", {})


def test_timestamp_watermark_delivery_checkpoint_updates_after_success(db_session: Session) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    _enable_incremental_fetch(
        db_session,
        stream_id,
        strategy="timestamp_watermark",
        watermark_field="$.ts",
    )
    _set_checkpoint(
        db_session,
        stream_id,
        {
            "incremental_fetch_watermark": "2026-01-02T11:00:00Z",
            "last_fetch_at": "2026-01-02T12:00:00Z",
        },
    )

    poller = _FakePoller(
        response={"items": [{"id": "evt-c", "message": "c", "ts": "2026-01-02T12:30:00Z"}]}
    )
    summary = _build_runner(
        poller=poller,
        webhook_sender=_FakeWebhookSender(),
    ).run(load_stream_context(db_session, stream_id), db=db_session)
    after = _checkpoint_value(db_session, stream_id)

    assert summary.get("checkpoint_updated") is True
    assert after["incremental_fetch_watermark"] == "2026-01-02T12:30:00Z"
    assert after["delivery_checkpoint"]["last_success_event"]["event_id"] == "evt-c"
    assert after.get("last_delivery_at") is not None


def test_closed_window_watermark_bounds_and_fetch_advance_without_events(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    _enable_incremental_fetch(
        db_session,
        stream_id,
        strategy="closed_window_watermark",
        watermark_field="$.ts",
        stability_lag_seconds=120,
        initial_lookback_seconds=3600,
    )
    _set_checkpoint(db_session, stream_id, {"incremental_fetch_watermark": "2026-01-01T00:00:00Z"})

    fixed_now = datetime(2026, 7, 2, 12, 0, 0, tzinfo=timezone.utc)
    monkeypatch.setattr("app.runtime.incremental_fetch._utcnow", lambda: fixed_now)
    monkeypatch.setattr("app.runners.stream_runner.time.monotonic", lambda: 0.0)

    poller = _FakePoller(response={"items": []})
    runner = _build_runner(poller=poller, webhook_sender=_FakeWebhookSender())
    context = load_stream_context(db_session, stream_id)
    summary = runner.run(context, db=db_session)
    after = _checkpoint_value(db_session, stream_id)

    assert poller.calls
    fetch_ctx = poller.calls[0]["checkpoint"]
    assert fetch_ctx["fetch_window_upper"] == "2026-07-02T11:58:00Z"
    assert fetch_ctx["fetch_window_lower"] == "2026-01-01T00:00:00Z"
    assert after["incremental_fetch_watermark"] == "2026-07-02T11:58:00Z"
    runtime_summary = summary.get("incremental_runtime_summary") or {}
    assert runtime_summary.get("strategy") == "closed_window_watermark"
    assert runtime_summary.get("stability_lag") == 120


def test_legacy_ui_checkpoint_auto_maps_closed_window_without_incremental_fetch(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Existing Record Selection UI saves checkpoint only — runtime must auto-enable framework."""

    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    row = db_session.query(Stream).filter(Stream.id == stream_id).one()
    cfg = dict(row.config_json or {})
    cfg.pop("incremental_fetch", None)
    cfg["checkpoint"] = {"mode": "Timestamp", "cursor_path": "$.items[*].creationTime"}
    cfg["event_array_path"] = "$.items"
    cfg["body"] = {
        "start": "{{checkpoint.fetch_window_lower}}",
        "end": "{{checkpoint.fetch_window_upper}}",
    }
    row.config_json = cfg
    db_session.add(row)
    db_session.commit()

    fixed_now = datetime(2026, 7, 2, 12, 0, 0, tzinfo=timezone.utc)
    monkeypatch.setattr("app.runtime.incremental_fetch._utcnow", lambda: fixed_now)

    poller = _FakePoller(
        response={
            "items": [
                {"id": "evt-1", "message": "one", "creationTime": "2026-07-02T11:00:00Z"},
                {"id": "evt-2", "message": "two", "creationTime": "2026-07-02T11:30:00Z"},
            ]
        }
    )
    runner = _build_runner(poller=poller, webhook_sender=_FakeWebhookSender())
    summary = runner.run(load_stream_context(db_session, stream_id), db=db_session)
    after = _checkpoint_value(db_session, stream_id)

    assert poller.calls
    fetch_ctx = poller.calls[0]["checkpoint"]
    assert fetch_ctx["fetch_window_upper"] == "2026-07-02T11:58:00Z"
    assert "fetch_window_upper" in fetch_ctx
    assert after["incremental_fetch_watermark"] == "2026-07-02T11:58:00Z"
    assert after["delivery_checkpoint"]["last_success_event"]["event_id"] == "evt-2"
    runtime_summary = summary.get("incremental_runtime_summary") or {}
    assert runtime_summary.get("strategy") == "closed_window_watermark"
    assert runtime_summary.get("stability_lag") == 120


def test_fetch_delivery_checkpoint_split_retry_success(db_session: Session) -> None:
    fixture = _seed_stream_runtime(db_session, failure_policies=["STOP_ON_FAILURE"])
    stream_id = int(fixture["stream_id"])
    _enable_incremental_fetch(
        db_session,
        stream_id,
        strategy="timestamp_watermark",
        watermark_field="$.ts",
    )
    _set_checkpoint(db_session, stream_id, {})

    fail_sender = _FakeWebhookSender(fail_urls={"https://receiver-0.example.com/events"})
    success_poller = _FakePoller(
        response={"items": [{"id": "evt-1", "message": "one", "ts": "2026-01-03T00:00:00Z"}]}
    )
    runner = _build_runner(poller=success_poller, webhook_sender=fail_sender)
    runner.run(load_stream_context(db_session, stream_id), db=db_session)
    after_fetch_only = _checkpoint_value(db_session, stream_id)
    assert after_fetch_only["incremental_fetch_watermark"] == "2026-01-03T00:00:00Z"
    assert "last_success_event" not in (after_fetch_only.get("delivery_checkpoint") or {})

    retry_poller = _FakePoller(
        response={"items": [{"id": "evt-2", "message": "two", "ts": "2026-01-03T01:00:00Z"}]}
    )
    success_runner = _build_runner(poller=retry_poller, webhook_sender=_FakeWebhookSender())
    success_summary = success_runner.run(load_stream_context(db_session, stream_id), db=db_session)
    after_success = _checkpoint_value(db_session, stream_id)

    assert success_summary.get("checkpoint_updated") is True
    assert after_success["incremental_fetch_watermark"] == "2026-01-03T01:00:00Z"
    assert after_success["delivery_checkpoint"]["last_success_event"]["event_id"] == "evt-2"


def test_dedup_and_incremental_together(db_session: Session) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    _enable_incremental_fetch(
        db_session,
        stream_id,
        strategy="cursor",
        cursor_field="$.id",
    )
    _enable_dedup(db_session, stream_id, key_field="id")
    _set_checkpoint(db_session, stream_id, {"connector_cursor": "evt-0"})

    poller = _FakePoller(
        response={
            "items": [
                {"id": "evt-1", "message": "one"},
                {"id": "evt-1", "message": "dup"},
                {"id": "evt-2", "message": "two"},
            ]
        }
    )
    summary = _build_runner(poller=poller, webhook_sender=_FakeWebhookSender()).run(
        load_stream_context(db_session, stream_id),
        db=db_session,
    )

    dedup = summary.get("dedup_summary") or {}
    runtime = summary.get("incremental_runtime_summary") or {}
    assert dedup.get("duplicate_events", 0) >= 1
    assert runtime.get("strategy") == "cursor"
    assert runtime.get("fetched") == 3
    assert runtime.get("duplicates") >= 1


def test_closed_window_delivery_failure_keeps_delivery_checkpoint(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    fixture = _seed_stream_runtime(db_session, failure_policies=["STOP_ON_FAILURE"])
    stream_id = int(fixture["stream_id"])
    _enable_incremental_fetch(
        db_session,
        stream_id,
        strategy="closed_window_watermark",
        watermark_field="$.ts",
        stability_lag_seconds=60,
    )
    _set_checkpoint(
        db_session,
        stream_id,
        {
            "incremental_fetch_watermark": "2026-01-01T00:00:00Z",
            "delivery_checkpoint": {"last_success_event": {"id": "seed"}},
        },
    )

    fixed_now = datetime(2026, 7, 2, 12, 0, 0, tzinfo=timezone.utc)
    monkeypatch.setattr("app.runtime.incremental_fetch._utcnow", lambda: fixed_now)

    poller = _FakePoller(
        response={"items": [{"id": "evt-x", "message": "x", "ts": "2026-07-01T00:00:00Z"}]}
    )
    sender = _FakeWebhookSender(fail_urls={"https://receiver-0.example.com/events"})
    summary = _build_runner(poller=poller, webhook_sender=sender).run(
        load_stream_context(db_session, stream_id),
        db=db_session,
    )
    after = _checkpoint_value(db_session, stream_id)

    assert summary.get("checkpoint_updated") is False
    assert after["delivery_checkpoint"]["last_success_event"]["id"] == "seed"
    assert after["incremental_fetch_watermark"] == "2026-07-02T11:59:00Z"
