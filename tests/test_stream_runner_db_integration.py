from __future__ import annotations

from typing import Any

import pytest

from app.runtime.stream_context import StreamContext
from app.runners.stream_runner import StreamRunner


class _AllowAllLimiter:
    def __init__(self, allow_value: bool = True) -> None:
        self.allow_value = allow_value

    def allow(self, _value: int) -> bool:
        return self.allow_value


class _Poller:
    def __init__(self) -> None:
        self.last_checkpoint: dict[str, Any] | None = None

    def fetch(self, source_config: dict[str, Any], stream_config: dict[str, Any], checkpoint: dict[str, Any] | None) -> Any:
        self.last_checkpoint = checkpoint
        return {"items": [{"id": "1"}]}


class _CheckpointSvc:
    def __init__(self) -> None:
        self.updated_db: list[tuple[int, str, dict[str, Any]]] = []
        self.db_checkpoint: dict[str, Any] | None = {"last_id": "0"}

    def get_checkpoint(self, db: Any, stream_id: int) -> dict[str, Any] | None:
        return self.db_checkpoint

    def get_checkpoint_for_stream(self, stream_id: int) -> dict[str, Any] | None:
        return None

    def update(self, stream_id: int, last_success_event: dict[str, Any]) -> None:
        return None

    def update_checkpoint_after_success(
        self,
        db: Any,
        stream_id: int,
        checkpoint_type: str,
        checkpoint_value: dict[str, Any],
    ) -> dict[str, Any]:
        self.updated_db.append((stream_id, checkpoint_type, checkpoint_value))
        return checkpoint_value


class _SenderOK:
    def send(self, events: list[dict[str, Any]], config: dict[str, Any]) -> None:
        return None


class _SenderFail:
    def send(self, events: list[dict[str, Any]], config: dict[str, Any]) -> None:
        raise RuntimeError("send failed")


def _build_context(failure_policy: str = "LOG_AND_CONTINUE") -> StreamContext:
    stream = {
        "id": 10,
        "enabled": True,
        "source_config": {"base_url": "https://api.example.com"},
        "stream_config": {"endpoint": "/events", "event_array_path": "$.items"},
        "field_mappings": {"event_id": "$.id"},
        "enrichment": {"vendor": "Acme"},
        "override_policy": "KEEP_EXISTING",
        "routes": [
            {
                "id": 100,
                "enabled": True,
                "failure_policy": failure_policy,
                "destination": {
                    "id": 200,
                    "destination_type": "WEBHOOK_POST",
                    "config": {"url": "https://receiver"},
                },
            }
        ],
    }
    return StreamContext(
        stream=stream,
        source={},
        mapping=None,
        enrichment=None,
        routes=stream["routes"],
        destinations_by_route={100: stream["routes"][0]["destination"]},
        checkpoint={"type": "EVENT_ID", "value": {"last_id": "0"}},
    )


def test_stream_runner_updates_checkpoint_on_success(monkeypatch: pytest.MonkeyPatch) -> None:
    checkpoint_service = _CheckpointSvc()
    runner = StreamRunner(
        poller=_Poller(),
        source_limiter=_AllowAllLimiter(True),
        destination_limiter=_AllowAllLimiter(True),
        checkpoint_service=checkpoint_service,
        webhook_sender=_SenderOK(),
        syslog_sender=_SenderOK(),
    )

    db = type("DB", (), {"query": lambda self, model: None})()
    runner.run(_build_context("LOG_AND_CONTINUE"), db=db)
    assert checkpoint_service.updated_db


def test_stream_runner_preserves_checkpoint_type_from_context() -> None:
    checkpoint_service = _CheckpointSvc()
    runner = StreamRunner(
        poller=_Poller(),
        source_limiter=_AllowAllLimiter(True),
        destination_limiter=_AllowAllLimiter(True),
        checkpoint_service=checkpoint_service,
        webhook_sender=_SenderOK(),
        syslog_sender=_SenderOK(),
    )
    context = _build_context("LOG_AND_CONTINUE")
    context.checkpoint = {
        "type": "TIMESTAMP",
        "value": {"last_timestamp": "2026-05-05T00:00:00Z"},
    }
    db = type("DB", (), {"query": lambda self, model: None})()

    runner.run(context, db=db)

    assert checkpoint_service.updated_db
    _, checkpoint_type, _ = checkpoint_service.updated_db[-1]
    assert checkpoint_type == "TIMESTAMP"


def test_stream_runner_uses_db_checkpoint_type_value_when_context_missing() -> None:
    poller = _Poller()
    checkpoint_service = _CheckpointSvc()
    checkpoint_service.db_checkpoint = {
        "type": "TIMESTAMP",
        "value": {"last_timestamp": "2026-05-05T00:00:00Z"},
    }
    runner = StreamRunner(
        poller=poller,
        source_limiter=_AllowAllLimiter(True),
        destination_limiter=_AllowAllLimiter(True),
        checkpoint_service=checkpoint_service,
        webhook_sender=_SenderOK(),
        syslog_sender=_SenderOK(),
    )
    context = _build_context("LOG_AND_CONTINUE")
    context.checkpoint = None
    db = type("DB", (), {"query": lambda self, model: None})()

    runner.run(context, db=db)

    assert poller.last_checkpoint == {"last_timestamp": "2026-05-05T00:00:00Z"}
    assert checkpoint_service.updated_db
    _, checkpoint_type, _ = checkpoint_service.updated_db[-1]
    assert checkpoint_type == "TIMESTAMP"


def test_stream_runner_does_not_update_checkpoint_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.runners import stream_runner as mod

    checkpoint_service = _CheckpointSvc()
    runner = StreamRunner(
        poller=_Poller(),
        source_limiter=_AllowAllLimiter(True),
        destination_limiter=_AllowAllLimiter(True),
        checkpoint_service=checkpoint_service,
        webhook_sender=_SenderFail(),
        syslog_sender=_SenderOK(),
    )
    called: list[int] = []
    monkeypatch.setattr(mod, "disable_route", lambda _db, route_id: called.append(route_id))
    db = type("DB", (), {"query": lambda self, model: None})()
    context = _build_context("DISABLE_ROUTE_ON_FAILURE")
    runner.run(context, db=db)
    assert checkpoint_service.updated_db == []
    assert called == [100]
    assert context.stream["routes"][0]["enabled"] is False


def test_stream_runner_pauses_on_pause_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.runners import stream_runner as mod

    checkpoint_service = _CheckpointSvc()
    runner = StreamRunner(
        poller=_Poller(),
        source_limiter=_AllowAllLimiter(True),
        destination_limiter=_AllowAllLimiter(True),
        checkpoint_service=checkpoint_service,
        webhook_sender=_SenderFail(),
        syslog_sender=_SenderOK(),
    )
    statuses: list[str] = []
    monkeypatch.setattr(mod, "update_stream_status", lambda _db, _sid, status: statuses.append(status))
    db = type("DB", (), {"query": lambda self, model: None})()
    context = _build_context("PAUSE_STREAM_ON_FAILURE")
    runner.run(context, db=db)
    assert context.stream["status"] == "PAUSED"
    assert "PAUSED" in statuses


def test_stream_runner_source_rate_limited_updates_status(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.runners import stream_runner as mod

    checkpoint_service = _CheckpointSvc()
    runner = StreamRunner(
        poller=_Poller(),
        source_limiter=_AllowAllLimiter(False),
        destination_limiter=_AllowAllLimiter(True),
        checkpoint_service=checkpoint_service,
        webhook_sender=_SenderOK(),
        syslog_sender=_SenderOK(),
    )
    statuses: list[str] = []
    monkeypatch.setattr(mod, "update_stream_status", lambda _db, _sid, status: statuses.append(status))
    db = type("DB", (), {"query": lambda self, model: None})()
    context = _build_context("LOG_AND_CONTINUE")
    runner.run(context, db=db)
    assert context.stream["status"] == "RATE_LIMITED_SOURCE"
    assert "RATE_LIMITED_SOURCE" in statuses
    assert checkpoint_service.updated_db == []


def test_stream_runner_destination_rate_limited_updates_status(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.runners import stream_runner as mod

    checkpoint_service = _CheckpointSvc()
    runner = StreamRunner(
        poller=_Poller(),
        source_limiter=_AllowAllLimiter(True),
        destination_limiter=_AllowAllLimiter(False),
        checkpoint_service=checkpoint_service,
        webhook_sender=_SenderOK(),
        syslog_sender=_SenderOK(),
    )
    statuses: list[str] = []
    monkeypatch.setattr(mod, "update_stream_status", lambda _db, _sid, status: statuses.append(status))
    db = type("DB", (), {"query": lambda self, model: None})()
    context = _build_context("LOG_AND_CONTINUE")
    runner.run(context, db=db)
    assert context.stream["status"] == "RATE_LIMITED_DESTINATION"
    assert "RATE_LIMITED_DESTINATION" in statuses
    assert checkpoint_service.updated_db == []
