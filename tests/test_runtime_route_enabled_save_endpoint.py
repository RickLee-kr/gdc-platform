from __future__ import annotations

from types import MethodType
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.database import get_db
from app.destinations.models import Destination
from app.logs.models import DeliveryLog
from app.main import app
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream


def _seed_route(db: Session) -> Route:
    connector = Connector(name="enabled-save-connector", description=None, status="RUNNING")
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
        name="enabled-save-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db.add(stream)
    db.flush()
    destination = Destination(
        name="enabled-save-dest",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://receiver.example.com/hook"},
        rate_limit_json={},
        enabled=True,
    )
    db.add(destination)
    db.flush()
    route = Route(
        stream_id=stream.id,
        destination_id=destination.id,
        enabled=True,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={"message_format": "json"},
        rate_limit_json={"max_events": 123},
        status="ENABLED",
    )
    db.add(route)
    db.add(
        Checkpoint(
            stream_id=stream.id,
            checkpoint_type="EVENT_ID",
            checkpoint_value_json={"last_success_event": {"event_id": "seed-0"}},
        )
    )
    db.commit()
    db.refresh(route)
    return route


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def _count_commits(db: Session) -> list[None]:
    original_commit = db.commit
    calls: list[None] = []

    def _wrapped_commit(self: Session) -> None:
        calls.append(None)
        original_commit()

    db.commit = MethodType(_wrapped_commit, db)  # type: ignore[method-assign]
    return calls


def _count_refreshes(db: Session) -> list[Any]:
    original_refresh = db.refresh
    calls: list[Any] = []

    def _wrapped_refresh(self: Session, instance: Any) -> None:  # noqa: ANN401
        calls.append(instance)
        original_refresh(instance)

    db.refresh = MethodType(_wrapped_refresh, db)  # type: ignore[method-assign]
    return calls


def _counts_snapshot(db: Session) -> dict[str, int]:
    return {
        "connectors": int(db.query(func.count(Connector.id)).scalar() or 0),
        "sources": int(db.query(func.count(Source.id)).scalar() or 0),
        "streams": int(db.query(func.count(Stream.id)).scalar() or 0),
        "destinations": int(db.query(func.count(Destination.id)).scalar() or 0),
        "routes": int(db.query(func.count(Route.id)).scalar() or 0),
        "checkpoints": int(db.query(func.count(Checkpoint.id)).scalar() or 0),
        "delivery_logs": int(db.query(func.count(DeliveryLog.id)).scalar() or 0),
    }


def test_route_enabled_save_enabled_false_success(client: TestClient, db_session: Session) -> None:
    route = _seed_route(db_session)
    before = _counts_snapshot(db_session)
    before_route = db_session.query(Route).filter(Route.id == route.id).one()
    before_fields = {
        "failure_policy": before_route.failure_policy,
        "formatter_config_json": dict(before_route.formatter_config_json or {}),
        "rate_limit_json": dict(before_route.rate_limit_json or {}),
    }

    commit_calls = _count_commits(db_session)
    refresh_calls = _count_refreshes(db_session)
    response = client.post(
        f"/api/v1/runtime/routes/{route.id}/enabled/save",
        json={"enabled": False},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["route_id"] == route.id
    assert body["stream_id"] == route.stream_id
    assert body["destination_id"] == route.destination_id
    assert body["enabled"] is False
    assert body["message"] == "Route enabled state saved successfully"

    assert len(commit_calls) == 1
    assert len(refresh_calls) == 1

    after = _counts_snapshot(db_session)
    assert after == before

    after_route = db_session.query(Route).filter(Route.id == route.id).one()
    assert after_route.enabled is False
    assert after_route.failure_policy == before_fields["failure_policy"]
    assert dict(after_route.formatter_config_json or {}) == before_fields["formatter_config_json"]
    assert dict(after_route.rate_limit_json or {}) == before_fields["rate_limit_json"]


def test_route_enabled_save_enabled_true_success(client: TestClient, db_session: Session) -> None:
    route = _seed_route(db_session)
    # disable first (direct DB) to test enable API path
    route.enabled = False
    db_session.commit()
    db_session.refresh(route)

    commit_calls = _count_commits(db_session)
    refresh_calls = _count_refreshes(db_session)
    response = client.post(
        f"/api/v1/runtime/routes/{route.id}/enabled/save",
        json={"enabled": True},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is True
    assert len(commit_calls) == 1
    assert len(refresh_calls) == 1


def test_route_enabled_save_overwrite_success(client: TestClient, db_session: Session) -> None:
    route = _seed_route(db_session)

    response1 = client.post(f"/api/v1/runtime/routes/{route.id}/enabled/save", json={"enabled": False})
    assert response1.status_code == 200
    response2 = client.post(f"/api/v1/runtime/routes/{route.id}/enabled/save", json={"enabled": True})
    assert response2.status_code == 200
    assert response2.json()["enabled"] is True


def test_route_enabled_save_idempotent_success(client: TestClient, db_session: Session) -> None:
    route = _seed_route(db_session)
    response1 = client.post(f"/api/v1/runtime/routes/{route.id}/enabled/save", json={"enabled": True})
    response2 = client.post(f"/api/v1/runtime/routes/{route.id}/enabled/save", json={"enabled": True})
    assert response1.status_code == 200
    assert response2.status_code == 200
    assert response2.json()["enabled"] is True


def test_route_enabled_save_route_not_found_returns_404(client: TestClient) -> None:
    response = client.post("/api/v1/runtime/routes/999999/enabled/save", json={"enabled": False})
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail["error_code"] == "ROUTE_NOT_FOUND"


def test_route_enabled_save_enabled_missing_returns_422(client: TestClient, db_session: Session) -> None:
    route = _seed_route(db_session)
    response = client.post(f"/api/v1/runtime/routes/{route.id}/enabled/save", json={})
    assert response.status_code == 422


@pytest.mark.parametrize(
    "bad_value",
    [
        "false",
        ["nope"],
        {"x": 1},
        None,
    ],
)
def test_route_enabled_save_enabled_invalid_type_returns_422(
    client: TestClient, db_session: Session, bad_value: Any
) -> None:
    route = _seed_route(db_session)
    response = client.post(f"/api/v1/runtime/routes/{route.id}/enabled/save", json={"enabled": bad_value})
    assert response.status_code == 422


def test_route_enabled_save_does_not_modify_other_entities(client: TestClient, db_session: Session) -> None:
    route = _seed_route(db_session)
    stream = db_session.query(Stream).filter(Stream.id == route.stream_id).one()
    destination = db_session.query(Destination).filter(Destination.id == route.destination_id).one()
    checkpoint = db_session.query(Checkpoint).filter(Checkpoint.stream_id == route.stream_id).one()

    before = {
        "stream": {
            "enabled": stream.enabled,
            "status": stream.status,
            "rate_limit_json": dict(stream.rate_limit_json or {}),
        },
        "destination": {
            "enabled": destination.enabled,
            "destination_type": destination.destination_type,
            "config_json": dict(destination.config_json or {}),
            "rate_limit_json": dict(destination.rate_limit_json or {}),
        },
        "checkpoint": {
            "type": checkpoint.checkpoint_type,
            "value": dict(checkpoint.checkpoint_value_json or {}),
        },
        "delivery_log_count": int(db_session.query(func.count(DeliveryLog.id)).scalar() or 0),
    }

    response = client.post(f"/api/v1/runtime/routes/{route.id}/enabled/save", json={"enabled": False})
    assert response.status_code == 200

    stream2 = db_session.query(Stream).filter(Stream.id == route.stream_id).one()
    destination2 = db_session.query(Destination).filter(Destination.id == route.destination_id).one()
    checkpoint2 = db_session.query(Checkpoint).filter(Checkpoint.stream_id == route.stream_id).one()

    after = {
        "stream": {
            "enabled": stream2.enabled,
            "status": stream2.status,
            "rate_limit_json": dict(stream2.rate_limit_json or {}),
        },
        "destination": {
            "enabled": destination2.enabled,
            "destination_type": destination2.destination_type,
            "config_json": dict(destination2.config_json or {}),
            "rate_limit_json": dict(destination2.rate_limit_json or {}),
        },
        "checkpoint": {
            "type": checkpoint2.checkpoint_type,
            "value": dict(checkpoint2.checkpoint_value_json or {}),
        },
        "delivery_log_count": int(db_session.query(func.count(DeliveryLog.id)).scalar() or 0),
    }

    assert after == before


def test_runtime_route_failure_policy_api_regression(client: TestClient, db_session: Session) -> None:
    route = _seed_route(db_session)
    response = client.post(
        f"/api/v1/runtime/routes/{route.id}/failure-policy/save",
        json={"failure_policy": "LOG_AND_CONTINUE"},
    )
    assert response.status_code == 200
    assert response.json()["route_id"] == route.id


def test_runtime_route_rate_limit_api_regression(client: TestClient, db_session: Session) -> None:
    route = _seed_route(db_session)
    response = client.post(
        f"/api/v1/runtime/routes/{route.id}/rate-limit/save",
        json={"rate_limit": {"max_events": 1, "per_seconds": 1}},
    )
    assert response.status_code == 200
    assert response.json()["route_id"] == route.id


def test_runtime_destination_rate_limit_api_regression(client: TestClient, db_session: Session) -> None:
    route = _seed_route(db_session)
    response = client.post(
        f"/api/v1/runtime/destinations/{route.destination_id}/rate-limit/save",
        json={"rate_limit": {"max_events": 1, "per_seconds": 1}},
    )
    assert response.status_code == 200
    assert response.json()["destination_id"] == route.destination_id


def test_runtime_stream_rate_limit_api_regression(client: TestClient, db_session: Session) -> None:
    route = _seed_route(db_session)
    response = client.post(
        f"/api/v1/runtime/streams/{route.stream_id}/rate-limit/save",
        json={"rate_limit": {"max_requests": 1, "per_seconds": 1}},
    )
    assert response.status_code == 200
    assert response.json()["stream_id"] == route.stream_id

