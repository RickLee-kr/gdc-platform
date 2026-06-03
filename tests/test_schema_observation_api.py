"""Runtime API for observed schema read path."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db
from app.main import app
from app.schema_observation.service import observe_extracted_events


@pytest.fixture
def observed_schema_client(db_session: Session) -> TestClient:
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


def test_get_observed_schema_endpoint(db_session: Session, observed_schema_client: TestClient) -> None:
    from app.connectors.models import Connector
    from app.sources.models import Source
    from app.streams.models import Stream

    connector = Connector(name="api-obs", description="", status="STOPPED")
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
        name="api-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        enabled=True,
        status="STOPPED",
    )
    db_session.add(stream)
    db_session.commit()

    observe_extracted_events(db_session, stream.id, [{"field_a": "x", "field_b": 2}])
    db_session.commit()

    resp = observed_schema_client.get(f"/api/v1/runtime/streams/{stream.id}/observed-schema")
    assert resp.status_code == 200
    body = resp.json()
    assert body["stream_id"] == stream.id
    assert body["path_count"] >= 2
    path_set = {entry["path"] for entry in body["paths"]}
    assert "$.field_a" in path_set
    assert "$.field_b" in path_set


def test_get_observed_schema_not_found_stream(observed_schema_client: TestClient) -> None:
    resp = observed_schema_client.get("/api/v1/runtime/streams/999999999/observed-schema")
    assert resp.status_code == 404
