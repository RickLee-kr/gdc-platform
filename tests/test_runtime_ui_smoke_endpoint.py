from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
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
from tests.test_runtime_logs_page_endpoint import _log as _delivery_log
from tests.test_runtime_logs_page_endpoint import _seed_stream_two_routes


@pytest.fixture
def runtime_ui_smoke_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_runtime_ui_config_save_smoke_workflow(runtime_ui_smoke_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    connector_id = h["connector_id"]
    stream_id = h["stream_id"]
    route_id = h["route_a_id"]
    destination_id = h["dest_a_id"]

    stream = db_session.query(Stream).filter(Stream.id == stream_id).one()
    source_id = int(stream.source_id)

    checkpoint = db_session.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).one()
    _delivery_log(
        db_session,
        connector_id=connector_id,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        stage="run_complete",
    )
    db_session.commit()
    before_checkpoint = (checkpoint.checkpoint_type, dict(checkpoint.checkpoint_value_json or {}))
    before_logs = db_session.query(DeliveryLog).count()

    # Representative UI config endpoints
    assert runtime_ui_smoke_client.get(f"/api/v1/runtime/connectors/{connector_id}/ui/config").status_code == 200
    assert runtime_ui_smoke_client.get(f"/api/v1/runtime/sources/{source_id}/ui/config").status_code == 200
    assert runtime_ui_smoke_client.get(f"/api/v1/runtime/streams/{stream_id}/ui/config").status_code == 200
    assert runtime_ui_smoke_client.get(f"/api/v1/runtime/streams/{stream_id}/mapping-ui/config").status_code == 200
    assert runtime_ui_smoke_client.get(f"/api/v1/runtime/routes/{route_id}/ui/config").status_code == 200
    assert runtime_ui_smoke_client.get(f"/api/v1/runtime/destinations/{destination_id}/ui/config").status_code == 200

    # Representative UI save endpoints
    assert (
        runtime_ui_smoke_client.post(
            f"/api/v1/runtime/connectors/{connector_id}/ui/save",
            json={"name": "connector-smoke", "description": "ui-smoke", "status": "RUNNING"},
        ).status_code
        == 200
    )
    assert (
        runtime_ui_smoke_client.post(
            f"/api/v1/runtime/sources/{source_id}/ui/save",
            json={"enabled": False, "config_json": {"url": "https://source-smoke"}, "auth_json": {"token": "smoke"}},
        ).status_code
        == 200
    )
    assert (
        runtime_ui_smoke_client.post(
            f"/api/v1/runtime/streams/{stream_id}/ui/save",
            json={
                "name": "stream-smoke",
                "enabled": False,
                "polling_interval": 90,
                "config_json": {"endpoint": "/smoke"},
                "rate_limit_json": {"max_requests": 77},
            },
        ).status_code
        == 200
    )
    assert (
        runtime_ui_smoke_client.post(
            f"/api/v1/runtime/routes/{route_id}/ui/save",
            json={
                "route_enabled": False,
                "destination_enabled": False,
                "failure_policy": "PAUSE_STREAM_ON_FAILURE",
                "route_formatter_config": {"message_format": "json", "tag": "smoke"},
                "route_rate_limit": {"max_per_second": 4},
            },
        ).status_code
        == 200
    )
    assert (
        runtime_ui_smoke_client.post(
            f"/api/v1/runtime/destinations/{destination_id}/ui/save",
            json={
                "name": "dest-smoke",
                "enabled": True,
                "config_json": {"url": "https://dest-smoke"},
                "rate_limit_json": {"max_per_second": 6},
            },
        ).status_code
        == 200
    )

    db_session.expire_all()
    connector = db_session.query(Connector).filter(Connector.id == connector_id).one()
    source = db_session.query(Source).filter(Source.id == source_id).one()
    stream2 = db_session.query(Stream).filter(Stream.id == stream_id).one()
    route = db_session.query(Route).filter(Route.id == route_id).one()
    destination = db_session.query(Destination).filter(Destination.id == destination_id).one()
    checkpoint2 = db_session.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).one()

    # Intended changes
    assert connector.name == "connector-smoke"
    assert connector.description == "ui-smoke"
    assert connector.status == "RUNNING"
    assert bool(source.enabled) is False
    assert dict(source.config_json or {}) == {"url": "https://source-smoke"}
    assert dict(source.auth_json or {}) == {"token": "smoke"}
    assert stream2.name == "stream-smoke"
    assert bool(stream2.enabled) is False
    assert int(stream2.polling_interval) == 90
    assert dict(stream2.config_json or {}) == {"endpoint": "/smoke"}
    assert dict(stream2.rate_limit_json or {}) == {"max_requests": 77}
    assert bool(route.enabled) is False
    assert str(route.failure_policy) == "PAUSE_STREAM_ON_FAILURE"
    assert dict(route.formatter_config_json or {}).get("tag") == "smoke"
    assert dict(route.rate_limit_json or {}) == {"max_per_second": 4}
    assert destination.name == "dest-smoke"
    assert bool(destination.enabled) is True
    assert dict(destination.config_json or {}) == {"url": "https://dest-smoke"}
    assert dict(destination.rate_limit_json or {}) == {"max_per_second": 6}

    # Protected state unchanged
    assert (checkpoint2.checkpoint_type, dict(checkpoint2.checkpoint_value_json or {})) == before_checkpoint
    assert db_session.query(DeliveryLog).count() == before_logs

    # Preview regression still works after UI saves
    preview = runtime_ui_smoke_client.post(
        "/api/v1/runtime/preview/mapping",
        json={
            "raw_response": {"items": [{"id": "evt-smoke-1"}]},
            "event_array_path": "$.items",
            "field_mappings": {"event_id": "$.id"},
            "enrichment": {"vendor": "Acme"},
            "override_policy": "KEEP_EXISTING",
        },
    )
    assert preview.status_code == 200
    body = preview.json()
    assert body["input_event_count"] == 1
    assert body["mapped_event_count"] == 1
    assert body["preview_events"][0]["event_id"] == "evt-smoke-1"


def test_route_ui_save_missing_destination_row_returns_destination_not_found(
    runtime_ui_smoke_client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Route exists but Destination row missing: HTTP 404 DESTINATION_NOT_FOUND (not ROUTE_NOT_FOUND)."""
    h = _seed_stream_two_routes(db_session)
    route_id = h["route_a_id"]
    dest_id = h["dest_a_id"]
    orig_query = db_session.query

    def patched_query(model: Any) -> Any:
        if model is Destination:
            m = MagicMock()
            m.filter.return_value.first.return_value = None
            return m
        return orig_query(model)

    monkeypatch.setattr(db_session, "query", patched_query)
    r = runtime_ui_smoke_client.post(
        f"/api/v1/runtime/routes/{route_id}/ui/save",
        json={"route_enabled": False},
    )
    assert r.status_code == 404
    detail = r.json()["detail"]
    assert detail["error_code"] == "DESTINATION_NOT_FOUND"
    assert detail["message"] == f"destination not found: {dest_id}"
