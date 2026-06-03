"""Schema drift Milestone 3a — primitive field type change detection."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema_observation.models import (
    DRIFT_CATEGORY_FIELD_TYPE_CHANGED,
    StreamSchemaFieldDrift,
)
from app.schema_observation.service import observe_extracted_events


def _seed_stream(db_session: Session) -> int:
    from app.connectors.models import Connector
    from app.sources.models import Source
    from app.streams.models import Stream

    connector = Connector(name="type-drift-conn", description="", status="STOPPED")
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
        name="type-drift-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        enabled=True,
        status="STOPPED",
    )
    db_session.add(stream)
    db_session.commit()
    return stream.id


@pytest.fixture
def type_drift_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_OBSERVATION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_DRIFT_DETECTION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_BASELINE_MIN_RUNS", 1)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_BASELINE_MIN_EVENTS", 1)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_DRIFT_ADDED_CONFIRM_RUNS", 99)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_DRIFT_REMOVED_ABSENT_RUNS", 99)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_DRIFT_TYPE_CHANGE_CONFIRM_RUNS", 3)


def _open_type_changed(db_session: Session, stream_id: int) -> list[StreamSchemaFieldDrift]:
    return list(
        db_session.execute(
            select(StreamSchemaFieldDrift).where(
                StreamSchemaFieldDrift.stream_id == stream_id,
                StreamSchemaFieldDrift.status == "open",
                StreamSchemaFieldDrift.category == DRIFT_CATEGORY_FIELD_TYPE_CHANGED,
            )
        ).scalars()
    )


def _establish_baseline(db_session: Session, stream_id: int, payload: dict) -> None:
    observe_extracted_events(db_session, stream_id, [payload])
    db_session.commit()


def _observe_runs(db_session: Session, stream_id: int, payload: dict, runs: int) -> None:
    for _ in range(runs):
        observe_extracted_events(db_session, stream_id, [payload])
        db_session.commit()


def test_string_to_number_type_change(db_session: Session, type_drift_settings: None) -> None:
    stream_id = _seed_stream(db_session)
    _establish_baseline(db_session, stream_id, {"user": {"id": "abc"}})
    _observe_runs(db_session, stream_id, {"user": {"id": 42}}, 3)

    findings = _open_type_changed(db_session, stream_id)
    assert len(findings) == 1
    assert findings[0].field_path == "$.user.id"


def test_number_to_string_type_change(db_session: Session, type_drift_settings: None) -> None:
    stream_id = _seed_stream(db_session)
    _establish_baseline(db_session, stream_id, {"severity": 5})
    _observe_runs(db_session, stream_id, {"severity": "high"}, 3)

    findings = _open_type_changed(db_session, stream_id)
    assert any(f.field_path == "$.severity" for f in findings)


def test_object_to_string_type_change(db_session: Session, type_drift_settings: None) -> None:
    stream_id = _seed_stream(db_session)
    _establish_baseline(db_session, stream_id, {"user": {"name": "ada"}})
    _observe_runs(db_session, stream_id, {"user": "plain"}, 3)

    findings = _open_type_changed(db_session, stream_id)
    assert any(f.field_path == "$.user" for f in findings)


def test_array_to_object_type_change(db_session: Session, type_drift_settings: None) -> None:
    stream_id = _seed_stream(db_session)
    _establish_baseline(db_session, stream_id, {"roles": ["admin", "user"]})
    _observe_runs(db_session, stream_id, {"roles": {"primary": "admin"}}, 3)

    findings = _open_type_changed(db_session, stream_id)
    assert any(f.field_path == "$.roles" for f in findings)


def test_null_type_change_ignored(db_session: Session, type_drift_settings: None) -> None:
    stream_id = _seed_stream(db_session)
    _establish_baseline(db_session, stream_id, {"label": "ok"})
    _observe_runs(db_session, stream_id, {"label": None}, 5)

    assert _open_type_changed(db_session, stream_id) == []


def test_mixed_type_change_ignored(db_session: Session, type_drift_settings: None) -> None:
    stream_id = _seed_stream(db_session)
    _establish_baseline(db_session, stream_id, {"value": "text"})
    for _ in range(5):
        observe_extracted_events(
            db_session,
            stream_id,
            [{"value": "text"}, {"value": 99}],
        )
        db_session.commit()

    assert _open_type_changed(db_session, stream_id) == []


def test_baseline_mixed_type_change_ignored(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_OBSERVATION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_DRIFT_DETECTION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_BASELINE_MIN_RUNS", 2)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_BASELINE_MIN_EVENTS", 1)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_DRIFT_TYPE_CHANGE_CONFIRM_RUNS", 1)

    stream_id = _seed_stream(db_session)
    observe_extracted_events(db_session, stream_id, [{"value": "a"}])
    db_session.commit()
    observe_extracted_events(db_session, stream_id, [{"value": 1}])
    db_session.commit()

    _observe_runs(db_session, stream_id, {"value": "only-string"}, 3)
    assert _open_type_changed(db_session, stream_id) == []


def test_type_change_confirm_runs_gate(db_session: Session, type_drift_settings: None) -> None:
    stream_id = _seed_stream(db_session)
    _establish_baseline(db_session, stream_id, {"metric": 1})
    _observe_runs(db_session, stream_id, {"metric": "x"}, 2)
    assert _open_type_changed(db_session, stream_id) == []

    observe_extracted_events(db_session, stream_id, [{"metric": "y"}])
    db_session.commit()
    assert len(_open_type_changed(db_session, stream_id)) == 1

