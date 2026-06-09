"""OSS v1.0.1 Sprint 7 — sensitive detection batch upsert."""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.sensitive_detection.detection import (
    _aggregate_hits,
    detect_hits_for_batch,
    persist_sensitive_hits,
)
from app.sensitive_detection.models import StreamSensitiveFinding


@pytest.fixture
def sensitive_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_SENSITIVE_DETECTION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_SENSITIVE_DETECTION_CONFIRM_RUNS", 2)


def _seed_stream(db_session: Session) -> int:
    from app.connectors.models import Connector
    from app.sources.models import Source
    from app.streams.models import Stream

    connector = Connector(name="s7-conn", description="", status="STOPPED")
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
        name="s7-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        enabled=True,
        status="STOPPED",
    )
    db_session.add(stream)
    db_session.commit()
    return stream.id


def _count_db_ops(db_session: Session, fn: Any) -> tuple[Any, int]:
    engine = db_session.get_bind()
    count = {"n": 0}

    def _before(_conn: object, _cursor: object, _statement: str, _parameters: object, _context: object, _executemany: bool) -> None:
        count["n"] += 1

    event.listen(engine, "before_cursor_execute", _before)
    try:
        result = fn()
        return result, int(count["n"])
    finally:
        event.remove(engine, "before_cursor_execute", _before)


def test_aggregate_hits_deduplicates_same_path_class() -> None:
    hits = [
        {"field_path": "$.api_key", "sensitivity_class": "secret", "detection_method": "field_name", "matched_rule": "a"},
        {"field_path": "$.api_key", "sensitivity_class": "secret", "detection_method": "field_name", "matched_rule": "b"},
    ]
    aggregated = _aggregate_hits(hits)
    assert len(aggregated) == 1
    assert aggregated[("$.api_key", "secret")]["matched_rule"] == "b"


def test_batch_upsert_reduces_db_queries(db_session: Session, sensitive_settings: None) -> None:
    stream_id = _seed_stream(db_session)
    events = [
        {
            "api_key": "a",
            "access_key": "b",
            "password": "c",
            "refresh_token": "d",
            "client_secret": "e",
        }
    ]
    hits = detect_hits_for_batch(events)
    assert len(hits) >= 3

    per_hit_estimate = len(hits) * 2
    _, batch_queries = _count_db_ops(
        db_session,
        lambda: persist_sensitive_hits(db_session, stream_id=stream_id, events=events, hits=hits),
    )
    assert batch_queries < per_hit_estimate


def test_batch_upsert_preserves_confirm_semantics(db_session: Session, sensitive_settings: None) -> None:
    stream_id = _seed_stream(db_session)
    events = [{"api_key": "x", "access_key": "y"}]

    persist_sensitive_hits(db_session, stream_id=stream_id, events=events)
    db_session.commit()
    rows = list(
        db_session.execute(
            select(StreamSensitiveFinding).where(StreamSensitiveFinding.stream_id == stream_id)
        ).scalars()
    )
    first_counts = {r.field_path: r.confirm_run_count for r in rows}

    persist_sensitive_hits(db_session, stream_id=stream_id, events=events)
    db_session.commit()
    rows = list(
        db_session.execute(
            select(StreamSensitiveFinding).where(StreamSensitiveFinding.stream_id == stream_id)
        ).scalars()
    )
    for row in rows:
        assert row.confirm_run_count == int(first_counts[row.field_path]) + 1
