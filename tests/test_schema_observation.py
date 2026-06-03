"""Schema observation Milestone 1 — path walking and StreamRunner integration."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.schema_observation.path_walker import collect_paths_from_event, collect_paths_from_events
from app.schema_observation.service import (
    build_observed_schema_read_model,
    observe_extracted_events,
    schema_observation_enabled,
)
from app.schema_observation.models import StreamObservedSchema
from app.runners.stream_loader import load_stream_context
from app.runners.stream_runner import StreamRunner
from tests.test_stream_runner_e2e import (
    _AllowAllLimiter,
    _FakePoller,
    _FakeWebhookSender,
    _FailIfCalledSyslogSender,
    _seed_stream_runtime,
)


def test_collect_paths_nested_and_array() -> None:
    event = {
        "username": "alice",
        "severity": 3,
        "event": {"id": "e-1", "timestamp": "2026-01-01T00:00:00Z"},
        "roles": [{"name": "admin"}, {"name": "viewer"}],
    }
    paths = collect_paths_from_event(event, max_depth=32, max_paths=500)
    assert paths["$.username"] == "string"
    assert paths["$.severity"] in ("integer", "number")
    assert paths["$.event"] == "object"
    assert paths["$.event.id"] == "string"
    assert paths["$.event.timestamp"] == "string"
    assert paths["$.roles"] == "array"
    assert paths["$.roles[]"] == "array"
    assert paths["$.roles[].name"] == "string"


def test_observe_extracted_events_persists_and_merges(db_session: Session) -> None:
    from app.streams.models import Stream
    from app.connectors.models import Connector
    from app.sources.models import Source

    connector = Connector(name="obs-conn", description="", status="STOPPED")
    db_session.add(connector)
    db_session.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={},
        auth_json={},
        enabled=True,
    )
    db_session.add(source)
    db_session.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="obs-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        enabled=True,
        status="STOPPED",
    )
    db_session.add(stream)
    db_session.commit()

    events = [{"username": "a", "severity": 1}, {"username": "b", "extra": True}]
    observe_extracted_events(db_session, stream.id, events)
    db_session.commit()

    row = db_session.get(StreamObservedSchema, stream.id)
    assert row is not None
    assert row.total_events_observed == 2
    assert row.observation_run_count == 1
    paths = row.paths_json["paths"]
    assert "$.username" in paths
    assert "$.severity" in paths
    assert "$.extra" in paths

    observe_extracted_events(db_session, stream.id, [{"username": "c"}])
    db_session.commit()
    db_session.refresh(row)
    assert row.observation_run_count == 2
    assert row.total_events_observed == 3
    assert int(paths["$.username"]["observation_count"]) >= 2


def test_stream_runner_records_observed_schema_on_extracted_events(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_OBSERVATION_ENABLED", True)
    seed = _seed_stream_runtime(db_session)
    stream_id = seed["stream_id"]
    poller = _FakePoller(
        {
            "items": [
                {"id": "evt-1", "message": "hello", "vendor": "acme", "nested": {"code": 1}},
            ]
        }
    )
    context = load_stream_context(db_session, stream_id)
    runner = StreamRunner(
        poller=poller,
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        webhook_sender=_FakeWebhookSender(),
        syslog_sender=_FailIfCalledSyslogSender(),
    )
    summary = runner.run(context, db=db_session)
    db_session.commit()

    assert summary.get("extracted_event_count") == 1
    row = db_session.get(StreamObservedSchema, stream_id)
    assert row is not None
    paths = row.paths_json.get("paths", {})
    assert "$.id" in paths
    assert "$.message" in paths
    assert "$.nested.code" in paths


def test_observed_schema_read_model_empty() -> None:
    model = build_observed_schema_read_model(stream_id=99, row=None)
    assert model["stream_id"] == 99
    assert model["path_count"] == 0
    assert model["observation_enabled"] == schema_observation_enabled()


def test_schema_observation_disabled_is_noop(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_OBSERVATION_ENABLED", False)
    from app.streams.models import Stream
    from app.connectors.models import Connector
    from app.sources.models import Source

    connector = Connector(name="obs-off", description="", status="STOPPED")
    db_session.add(connector)
    db_session.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={},
        auth_json={},
        enabled=True,
    )
    db_session.add(source)
    db_session.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="off",
        stream_type="HTTP_API_POLLING",
        config_json={},
        enabled=True,
        status="STOPPED",
    )
    db_session.add(stream)
    db_session.commit()
    observe_extracted_events(db_session, stream.id, [{"x": 1}])
    db_session.commit()
    assert db_session.get(StreamObservedSchema, stream.id) is None
