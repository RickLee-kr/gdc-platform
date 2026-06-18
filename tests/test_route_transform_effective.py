"""Route transform effective config API."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db, get_db_read_bounded
from app.enrichments.models import Enrichment
from app.main import app
from app.mappings.models import Mapping
from app.route_transform.models import RouteEnrichment, RouteMapping
from tests.test_runtime_logs_page_endpoint import _seed_stream_two_routes


@pytest.fixture
def route_effective_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_db_read_bounded] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_db_read_bounded, None)


def test_route_transform_effective_inherited(route_effective_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    mapping = db_session.query(Mapping).filter(Mapping.stream_id == h["stream_id"]).first()
    if mapping is None:
        db_session.add(Mapping(stream_id=h["stream_id"], field_mappings_json={"a": "$.a"}))
    else:
        mapping.field_mappings_json = {"a": "$.a"}
    enrichment = db_session.query(Enrichment).filter(Enrichment.stream_id == h["stream_id"]).first()
    if enrichment is None:
        db_session.add(
            Enrichment(
                stream_id=h["stream_id"],
                enrichment_json={"x": "1"},
                override_policy="KEEP_EXISTING",
                enabled=True,
            )
        )
    else:
        enrichment.enrichment_json = {"x": "1"}
        enrichment.override_policy = "KEEP_EXISTING"
        enrichment.enabled = True
    db_session.commit()

    r = route_effective_client.get(f"/api/v1/runtime/routes/{h['route_a_id']}/transform/effective")
    assert r.status_code == 200
    body = r.json()
    assert body["persisted_source"] == "stream"
    assert body["fallback_used"] is True
    assert body["mapping_source"] == "stream"
    assert body["enrichment_source"] == "stream"
    assert body["mapping_count"] == 1
    assert body["enrichment_count"] == 1
    assert body["processing_status"] == "Inherited"


def test_route_transform_effective_overridden(route_effective_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    mapping = db_session.query(Mapping).filter(Mapping.stream_id == h["stream_id"]).first()
    if mapping is None:
        db_session.add(Mapping(stream_id=h["stream_id"], field_mappings_json={"a": "$.a"}))
    else:
        mapping.field_mappings_json = {"a": "$.a"}
    enrichment = db_session.query(Enrichment).filter(Enrichment.stream_id == h["stream_id"]).first()
    if enrichment is None:
        db_session.add(
            Enrichment(
                stream_id=h["stream_id"],
                enrichment_json={"x": "1"},
                override_policy="KEEP_EXISTING",
                enabled=True,
            )
        )
    else:
        enrichment.enrichment_json = {"x": "1"}
    db_session.add(
        RouteMapping(
            route_id=h["route_a_id"],
            field_mappings_json={"route_a": "$.route"},
        )
    )
    db_session.add(
        RouteEnrichment(
            route_id=h["route_a_id"],
            enrichment_json={"route_x": "9"},
            override_policy="KEEP_EXISTING",
            enabled=True,
        )
    )
    db_session.commit()

    r = route_effective_client.get(f"/api/v1/runtime/routes/{h['route_a_id']}/transform/effective")
    body = r.json()
    assert body["persisted_source"] == "route"
    assert body["fallback_used"] is False
    assert body["processing_status"] == "Overridden"
    assert body["mapping_count"] == 1
    assert body["enrichment_count"] == 1


def test_route_transform_effective_mixed(route_effective_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    mapping = db_session.query(Mapping).filter(Mapping.stream_id == h["stream_id"]).first()
    if mapping is None:
        db_session.add(Mapping(stream_id=h["stream_id"], field_mappings_json={"a": "$.a", "b": "$.b"}))
    else:
        mapping.field_mappings_json = {"a": "$.a", "b": "$.b"}
    db_session.add(
        RouteMapping(
            route_id=h["route_a_id"],
            field_mappings_json={"route_only": "$.z"},
        )
    )
    db_session.commit()

    r = route_effective_client.get(f"/api/v1/runtime/routes/{h['route_a_id']}/transform/effective")
    body = r.json()
    assert body["persisted_source"] == "mixed"
    assert body["mapping_source"] == "route"
    assert body["enrichment_source"] == "stream"
    assert body["processing_status"] == "Mixed"
    assert body["fallback_used"] is True
