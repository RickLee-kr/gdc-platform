"""M5 sensitive detection — service hook (non-blocking)."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.sensitive_detection import service as sensitive_detection_service
from app.sensitive_detection.models import StreamSensitiveFinding


@pytest.fixture
def sensitive_runtime_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_SENSITIVE_DETECTION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_SENSITIVE_DETECTION_CONFIRM_RUNS", 1)


def _seed_stream(db_session: Session) -> int:
    from app.connectors.models import Connector
    from app.sources.models import Source
    from app.streams.models import Stream

    connector = Connector(name="sens-run-conn", description="", status="STOPPED")
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
        name="sens-run-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        enabled=True,
        status="STOPPED",
    )
    db_session.add(stream)
    db_session.commit()
    return stream.id


def test_detect_sensitive_fields_does_not_abort_on_failure(
    db_session: Session,
    sensitive_runtime_settings: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stream_id = _seed_stream(db_session)

    def _boom(*_a: object, **_k: object) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr("app.sensitive_detection.service.persist_sensitive_hits", _boom)

    sensitive_detection_service.detect_sensitive_fields(
        db_session,
        stream_id=stream_id,
        events=[{"api_key": "v"}],
    )


def test_detect_sensitive_fields_persists(
    db_session: Session,
    sensitive_runtime_settings: None,
) -> None:
    stream_id = _seed_stream(db_session)

    sensitive_detection_service.detect_sensitive_fields(
        db_session,
        stream_id=stream_id,
        events=[{"refresh_token": "t"}],
    )
    db_session.commit()

    rows = list(
        db_session.execute(
            select(StreamSensitiveFinding).where(StreamSensitiveFinding.stream_id == stream_id)
        ).scalars()
    )
    assert len(rows) >= 1
    assert any("refresh_token" in r.field_path for r in rows)
