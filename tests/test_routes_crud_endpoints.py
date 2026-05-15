from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.connectors.models import Connector
from app.database import get_db
from app.destinations.models import Destination
from app.main import app
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream


def _seed_stream_destination(db: Session) -> tuple[Stream, Destination]:
    connector = Connector(name="routes-crud-connector", description=None, status="RUNNING")
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
    db.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="routes-crud-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="STOPPED",
        rate_limit_json={},
    )
    destination = Destination(
        name="routes-crud-destination",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://receiver.example.com/routes-crud"},
        rate_limit_json={},
        enabled=True,
    )
    db.add(stream)
    db.add(destination)
    db.commit()
    db.refresh(stream)
    db.refresh(destination)
    return stream, destination


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_route_create_list_get_update_and_persist_fields(client: TestClient, db_session: Session) -> None:
    stream, destination = _seed_stream_destination(db_session)
    create_payload = {
        "stream_id": stream.id,
        "destination_id": destination.id,
        "enabled": True,
        "failure_policy": "RETRY_AND_BACKOFF",
        "formatter_config_json": {"message_format": "json"},
        "rate_limit_json": {"max_events": 100, "per_seconds": 1},
        "status": "ENABLED",
    }
    create_res = client.post("/api/v1/routes/", json=create_payload)
    assert create_res.status_code == 201
    created = create_res.json()
    route_id = int(created["id"])
    assert created["stream_id"] == stream.id
    assert created["destination_id"] == destination.id
    assert created["enabled"] is True
    assert created["failure_policy"] == "RETRY_AND_BACKOFF"

    list_res = client.get("/api/v1/routes/")
    assert list_res.status_code == 200
    assert any(int(row["id"]) == route_id for row in list_res.json())

    get_res = client.get(f"/api/v1/routes/{route_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == route_id

    update_res = client.put(
        f"/api/v1/routes/{route_id}",
        json={"enabled": False, "failure_policy": "DISABLE_ROUTE_ON_FAILURE"},
    )
    assert update_res.status_code == 200
    body = update_res.json()
    assert body["enabled"] is False
    assert body["failure_policy"] == "DISABLE_ROUTE_ON_FAILURE"

    row = db_session.query(Route).filter(Route.id == route_id).one()
    assert int(row.stream_id) == stream.id
    assert int(row.destination_id) == destination.id
    assert bool(row.enabled) is False
    assert str(row.failure_policy) == "DISABLE_ROUTE_ON_FAILURE"


def test_route_delete_conflict_when_enabled(client: TestClient, db_session: Session) -> None:
    stream, destination = _seed_stream_destination(db_session)
    create_res = client.post(
        "/api/v1/routes/",
        json={
            "stream_id": stream.id,
            "destination_id": destination.id,
            "enabled": True,
            "failure_policy": "LOG_AND_CONTINUE",
            "status": "ENABLED",
        },
    )
    assert create_res.status_code == 201
    route_id = int(create_res.json()["id"])

    del_res = client.delete(f"/api/v1/routes/{route_id}")
    assert del_res.status_code == 409
    assert db_session.query(Route).filter(Route.id == route_id).first() is not None


def test_route_delete_ok_when_disabled(client: TestClient, db_session: Session) -> None:
    stream, destination = _seed_stream_destination(db_session)
    create_res = client.post(
        "/api/v1/routes/",
        json={
            "stream_id": stream.id,
            "destination_id": destination.id,
            "enabled": False,
            "failure_policy": "LOG_AND_CONTINUE",
            "status": "DISABLED",
        },
    )
    assert create_res.status_code == 201
    route_id = int(create_res.json()["id"])

    del_res = client.delete(f"/api/v1/routes/{route_id}")
    assert del_res.status_code == 204
    assert db_session.query(Route).filter(Route.id == route_id).first() is None

