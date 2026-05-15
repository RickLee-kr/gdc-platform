from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.connectors.models import Connector
from app.database import get_db
from app.main import app
from app.sources.models import Source
from app.streams.models import Stream


def _seed_connector_source(db: Session) -> tuple[Connector, Source]:
    connector = Connector(name="streams-crud-connector", description=None, status="RUNNING")
    db.add(connector)
    db.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={},
        auth_json={},
        enabled=True,
    )
    db.add(source)
    db.commit()
    db.refresh(connector)
    db.refresh(source)
    return connector, source


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_stream_create_list_get_update(client: TestClient, db_session: Session) -> None:
    connector, source = _seed_connector_source(db_session)
    create_payload = {
        "name": "streams-crud-stream",
        "connector_id": connector.id,
        "source_id": source.id,
        "polling_interval": 30,
        "enabled": True,
        "status": "STOPPED",
        "stream_type": "HTTP_API_POLLING",
        "config_json": {"endpoint": "/events"},
        "rate_limit_json": {"max_requests": 60, "per_seconds": 60},
    }
    create_res = client.post("/api/v1/streams/", json=create_payload)
    assert create_res.status_code == 201
    created = create_res.json()
    stream_id = int(created["id"])
    assert created["connector_id"] == connector.id
    assert created["source_id"] == source.id
    assert created["name"] == "streams-crud-stream"

    list_res = client.get("/api/v1/streams/")
    assert list_res.status_code == 200
    assert any(int(row["id"]) == stream_id for row in list_res.json())

    get_res = client.get(f"/api/v1/streams/{stream_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == stream_id

    update_res = client.put(
        f"/api/v1/streams/{stream_id}",
        json={"name": "streams-crud-stream-updated", "polling_interval": 45, "enabled": False},
    )
    assert update_res.status_code == 200
    body = update_res.json()
    assert body["name"] == "streams-crud-stream-updated"
    assert body["enabled"] is False

    row = db_session.query(Stream).filter(Stream.id == stream_id).one()
    assert row.name == "streams-crud-stream-updated"
    assert int(row.polling_interval) == 45
    assert bool(row.enabled) is False

