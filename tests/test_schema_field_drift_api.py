"""Runtime API for schema field drift read path."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db
from app.main import app
from app.schema_observation.models import DRIFT_CATEGORY_FIELD_TYPE_CHANGED
from app.schema_observation.service import observe_extracted_events


@pytest.fixture
def drift_api_client(db_session: Session) -> TestClient:
    def _override_get_db():
        yield db_session

    def _override_get_db_read_bounded():
        yield db_session

    from app.database import get_db_read_bounded

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_db_read_bounded] = _override_get_db_read_bounded
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_db_read_bounded, None)


@pytest.fixture
def fast_drift(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_BASELINE_MIN_RUNS", 1)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_DRIFT_ADDED_CONFIRM_RUNS", 1)


def test_get_schema_field_drifts_endpoint(
    db_session: Session,
    drift_api_client: TestClient,
    fast_drift: None,
) -> None:
    from app.connectors.models import Connector
    from app.sources.models import Source
    from app.streams.models import Stream

    connector = Connector(name="drift-api", description="", status="STOPPED")
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
        name="drift-api-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        enabled=True,
        status="STOPPED",
    )
    db_session.add(stream)
    db_session.commit()

    observe_extracted_events(db_session, stream.id, [{"base": 1}])
    db_session.commit()
    observe_extracted_events(db_session, stream.id, [{"base": 1, "extra": "y"}])
    db_session.commit()

    resp = drift_api_client.get(f"/api/v1/runtime/streams/{stream.id}/schema-field-drifts")
    assert resp.status_code == 200
    body = resp.json()
    assert body["stream_id"] == stream.id
    assert body["baseline_established"] is True
    assert body["finding_count"] >= 1
    categories = {f["category"] for f in body["findings"]}
    assert "field_added" in categories


def test_get_schema_field_drifts_not_found(drift_api_client: TestClient) -> None:
    resp = drift_api_client.get("/api/v1/runtime/streams/999999999/schema-field-drifts")
    assert resp.status_code == 404


def test_get_schema_field_type_changed_finding(
    db_session: Session,
    drift_api_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_OBSERVATION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_DRIFT_DETECTION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_BASELINE_MIN_RUNS", 1)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_BASELINE_MIN_EVENTS", 1)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_DRIFT_TYPE_CHANGE_CONFIRM_RUNS", 1)

    from app.connectors.models import Connector
    from app.sources.models import Source
    from app.streams.models import Stream

    connector = Connector(name="type-drift-api", description="", status="STOPPED")
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
        name="type-drift-api-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        enabled=True,
        status="STOPPED",
    )
    db_session.add(stream)
    db_session.commit()

    observe_extracted_events(db_session, stream.id, [{"code": 100}])
    db_session.commit()
    observe_extracted_events(db_session, stream.id, [{"code": "ERR"}])
    db_session.commit()

    resp = drift_api_client.get(f"/api/v1/runtime/streams/{stream.id}/schema-field-drifts")
    assert resp.status_code == 200
    body = resp.json()
    type_findings = [f for f in body["findings"] if f["category"] == DRIFT_CATEGORY_FIELD_TYPE_CHANGED]
    assert len(type_findings) == 1
    assert type_findings[0]["finding"] == {
        "path": "$.code",
        "baseline_type": "integer",
        "current_type": "string",
    }
