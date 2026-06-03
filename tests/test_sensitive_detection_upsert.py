"""M5 sensitive detection — confirm gate and upsert semantics."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.sensitive_detection.detection import is_api_visible, persist_sensitive_hits
from app.sensitive_detection.models import (
    FINDING_STATUS_OPEN,
    FINDING_STATUS_RESOLVED,
    RESOLUTION_FALSE_POSITIVE,
    SENSITIVITY_CLASS_SECRET,
    StreamSensitiveFinding,
)


def _seed_stream(db_session: Session) -> int:
    from app.connectors.models import Connector
    from app.sources.models import Source
    from app.streams.models import Stream

    connector = Connector(name="sens-conn", description="", status="STOPPED")
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
        name="sens-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        enabled=True,
        status="STOPPED",
    )
    db_session.add(stream)
    db_session.commit()
    return stream.id


@pytest.fixture
def sensitive_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_SENSITIVE_DETECTION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_SENSITIVE_DETECTION_CONFIRM_RUNS", 2)


def _rows(db_session: Session, stream_id: int) -> list[StreamSensitiveFinding]:
    return list(
        db_session.execute(
            select(StreamSensitiveFinding).where(StreamSensitiveFinding.stream_id == stream_id)
        ).scalars()
    )


def test_confirm_gate_hides_until_second_run(db_session: Session, sensitive_settings: None) -> None:
    stream_id = _seed_stream(db_session)
    events = [{"api_key": "placeholder-not-stored"}]

    persist_sensitive_hits(db_session, stream_id=stream_id, events=events)
    db_session.commit()

    rows = _rows(db_session, stream_id)
    assert len(rows) == 1
    assert rows[0].confirm_run_count == 1
    assert not is_api_visible(rows[0])

    persist_sensitive_hits(db_session, stream_id=stream_id, events=events)
    db_session.commit()

    rows = _rows(db_session, stream_id)
    assert rows[0].confirm_run_count == 2
    assert is_api_visible(rows[0])


def test_resolved_not_reopened(db_session: Session, sensitive_settings: None) -> None:
    stream_id = _seed_stream(db_session)
    events = [{"password": "x"}]
    for _ in range(2):
        persist_sensitive_hits(db_session, stream_id=stream_id, events=events)
        db_session.commit()

    row = _rows(db_session, stream_id)[0]
    row.status = FINDING_STATUS_RESOLVED
    row.resolution = RESOLUTION_FALSE_POSITIVE
    db_session.commit()

    persist_sensitive_hits(db_session, stream_id=stream_id, events=events)
    db_session.commit()

    row = db_session.get(StreamSensitiveFinding, row.id)
    assert row is not None
    assert row.status == FINDING_STATUS_RESOLVED
    assert row.confirm_run_count == 2


def test_unique_per_path_class(db_session: Session, sensitive_settings: None) -> None:
    stream_id = _seed_stream(db_session)
    events = [{"api_key": "a", "access_key": "b"}]
    for _ in range(2):
        persist_sensitive_hits(db_session, stream_id=stream_id, events=events)
        db_session.commit()

    rows = _rows(db_session, stream_id)
    classes = {r.sensitivity_class for r in rows}
    assert SENSITIVITY_CLASS_SECRET in classes
    assert all(r.status == FINDING_STATUS_OPEN for r in rows)
