from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.database import get_db
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.logs.models import DeliveryLog
from app.main import app
from app.mappings.models import Mapping
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream
from tests.test_runtime_logs_page_endpoint import _log as _delivery_log
from tests.test_runtime_logs_page_endpoint import _seed_stream_two_routes


@pytest.fixture
def runtime_save_smoke_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_runtime_individual_save_smoke_scenario(runtime_save_smoke_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    connector_id = h["connector_id"]
    stream_id = h["stream_id"]
    route_id = h["route_a_id"]
    destination_id = h["dest_a_id"]
    route_b_id = h["route_b_id"]
    destination_b_id = h["dest_b_id"]

    stream = db_session.query(Stream).filter(Stream.id == stream_id).one()
    source_id = int(stream.source_id)
    source = db_session.query(Source).filter(Source.id == source_id).one()
    connector = db_session.query(Connector).filter(Connector.id == connector_id).one()
    route_b = db_session.query(Route).filter(Route.id == route_b_id).one()
    destination_b = db_session.query(Destination).filter(Destination.id == destination_b_id).one()
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
    before_log_count = db_session.query(DeliveryLog).count()
    before_source = (source.source_type, bool(source.enabled), dict(source.config_json or {}), dict(source.auth_json or {}))
    before_connector = (connector.name, connector.description, connector.status)
    before_route_b = (
        bool(route_b.enabled),
        str(route_b.failure_policy),
        dict(route_b.formatter_config_json or {}),
        dict(route_b.rate_limit_json or {}),
    )
    before_destination_b = (
        destination_b.name,
        bool(destination_b.enabled),
        dict(destination_b.config_json or {}),
        dict(destination_b.rate_limit_json or {}),
    )

    # Individual save APIs smoke chain
    assert (
        runtime_save_smoke_client.post(
            f"/api/v1/runtime/mappings/stream/{stream_id}/save",
            json={"event_array_path": "$.items", "field_mappings": {"event_id": "$.id"}},
        ).status_code
        == 200
    )
    assert (
        runtime_save_smoke_client.post(
            f"/api/v1/runtime/enrichments/stream/{stream_id}/save",
            json={"enrichment": {"vendor": "Acme"}, "override_policy": "override", "enabled": True},
        ).status_code
        == 200
    )
    assert (
        runtime_save_smoke_client.post(
            f"/api/v1/runtime/routes/{route_id}/formatter/save",
            json={"formatter_config": {"message_format": "json", "tag": "smoke"}},
        ).status_code
        == 200
    )
    assert (
        runtime_save_smoke_client.post(
            f"/api/v1/runtime/routes/{route_id}/failure-policy/save",
            json={"failure_policy": "PAUSE_STREAM_ON_FAILURE"},
        ).status_code
        == 200
    )
    assert (
        runtime_save_smoke_client.post(
            f"/api/v1/runtime/routes/{route_id}/enabled/save",
            json={"enabled": False},
        ).status_code
        == 200
    )
    assert (
        runtime_save_smoke_client.post(
            f"/api/v1/runtime/routes/{route_id}/rate-limit/save",
            json={"rate_limit": {"max_events": 9, "per_seconds": 1}},
        ).status_code
        == 200
    )
    assert (
        runtime_save_smoke_client.post(
            f"/api/v1/runtime/streams/{stream_id}/rate-limit/save",
            json={"rate_limit": {"max_requests": 30, "per_seconds": 60}},
        ).status_code
        == 200
    )
    assert (
        runtime_save_smoke_client.post(
            f"/api/v1/runtime/destinations/{destination_id}/rate-limit/save",
            json={"rate_limit": {"max_events": 20, "per_seconds": 2}},
        ).status_code
        == 200
    )

    db_session.expire_all()
    mapping = db_session.query(Mapping).filter(Mapping.stream_id == stream_id).one()
    enrichment = db_session.query(Enrichment).filter(Enrichment.stream_id == stream_id).one()
    route = db_session.query(Route).filter(Route.id == route_id).one()
    stream2 = db_session.query(Stream).filter(Stream.id == stream_id).one()
    destination = db_session.query(Destination).filter(Destination.id == destination_id).one()
    checkpoint2 = db_session.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).one()
    source2 = db_session.query(Source).filter(Source.id == source_id).one()
    connector2 = db_session.query(Connector).filter(Connector.id == connector_id).one()
    route_b2 = db_session.query(Route).filter(Route.id == route_b_id).one()
    destination_b2 = db_session.query(Destination).filter(Destination.id == destination_b_id).one()

    # Intended fields updated
    assert mapping.event_array_path == "$.items"
    assert dict(mapping.field_mappings_json or {}) == {"event_id": "$.id"}
    assert dict(enrichment.enrichment_json or {}) == {"vendor": "Acme"}
    assert str(enrichment.override_policy) == "OVERRIDE"
    assert bool(enrichment.enabled) is True
    assert dict(route.formatter_config_json or {})["tag"] == "smoke"
    assert str(route.failure_policy) == "PAUSE_STREAM_ON_FAILURE"
    assert bool(route.enabled) is False
    assert dict(route.rate_limit_json or {}) == {"max_events": 9, "per_seconds": 1}
    assert dict(stream2.rate_limit_json or {}) == {"max_requests": 30, "per_seconds": 60}
    assert dict(destination.rate_limit_json or {}) == {"max_events": 20, "per_seconds": 2}

    # Protected state unchanged
    assert (checkpoint2.checkpoint_type, dict(checkpoint2.checkpoint_value_json or {})) == before_checkpoint
    assert db_session.query(DeliveryLog).count() == before_log_count
    assert (
        source2.source_type,
        bool(source2.enabled),
        dict(source2.config_json or {}),
        dict(source2.auth_json or {}),
    ) == before_source
    assert (connector2.name, connector2.description, connector2.status) == before_connector
    assert (
        bool(route_b2.enabled),
        str(route_b2.failure_policy),
        dict(route_b2.formatter_config_json or {}),
        dict(route_b2.rate_limit_json or {}),
    ) == before_route_b
    assert (
        destination_b2.name,
        bool(destination_b2.enabled),
        dict(destination_b2.config_json or {}),
        dict(destination_b2.rate_limit_json or {}),
    ) == before_destination_b


def test_runtime_individual_save_smoke_edge_422(runtime_save_smoke_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    stream_id = h["stream_id"]
    route_id = h["route_a_id"]
    destination_id = h["dest_a_id"]

    assert (
        runtime_save_smoke_client.post(
            f"/api/v1/runtime/mappings/stream/{stream_id}/save",
            json={"field_mappings": {}},
        ).status_code
        == 422
    )
    assert (
        runtime_save_smoke_client.post(
            f"/api/v1/runtime/enrichments/stream/{stream_id}/save",
            json={"enrichment": {}},
        ).status_code
        == 422
    )
    assert (
        runtime_save_smoke_client.post(
            f"/api/v1/runtime/routes/{route_id}/formatter/save",
            json={"formatter_config": {}},
        ).status_code
        == 422
    )
    assert (
        runtime_save_smoke_client.post(
            f"/api/v1/runtime/routes/{route_id}/rate-limit/save",
            json={"rate_limit": {}},
        ).status_code
        == 422
    )
    assert (
        runtime_save_smoke_client.post(
            f"/api/v1/runtime/streams/{stream_id}/rate-limit/save",
            json={"rate_limit": {}},
        ).status_code
        == 422
    )
    assert (
        runtime_save_smoke_client.post(
            f"/api/v1/runtime/destinations/{destination_id}/rate-limit/save",
            json={"rate_limit": {}},
        ).status_code
        == 422
    )
    assert (
        runtime_save_smoke_client.post(
            f"/api/v1/runtime/routes/{route_id}/enabled/save",
            json={"enabled": "false"},
        ).status_code
        == 422
    )
