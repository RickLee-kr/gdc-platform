"""Tests for M17.5.4 Template Materialization API."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.connectors_registry.service import bootstrap_registry, clear_registry_cache
from app.database import get_db
from app.enrichments.models import Enrichment
from app.main import app
from app.mappings.models import Mapping
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream


def _seed_connector_with_source(db: Session, *, name: str = "CrowdStrike Lab") -> tuple[Connector, Source]:
    connector = Connector(name=name, description="materialize test", status="STOPPED")
    db.add(connector)
    db.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={"base_url": "https://api.crowdstrike.com"},
        auth_json={"auth_type": "bearer", "bearer_token": "test-token"},
        enabled=True,
    )
    db.add(source)
    db.commit()
    db.refresh(connector)
    db.refresh(source)
    return connector, source


@pytest.fixture
def client(db_session: Session) -> Any:
    clear_registry_cache()
    bootstrap_registry()

    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        clear_registry_cache()


def test_materialize_crowdstrike_detections(client: TestClient, db_session: Session) -> None:
    connector, _source = _seed_connector_with_source(db_session)
    res = client.post(
        "/api/v1/connector-templates/materialize",
        json={
            "connector_id": connector.id,
            "module_id": "crowdstrike",
            "templates": ["detections"],
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["module_id"] == "crowdstrike"
    assert body["connector_id"] == connector.id
    assert len(body["created_streams"]) == 1
    created = body["created_streams"][0]
    assert created["template_id"] == "detections"
    assert created["enabled"] is False
    assert created["status"] == "STOPPED"
    assert created["config_json"]["endpoint"] == "/detects/entities/detects/v2"
    assert created["rate_limit_json"]["max_requests"] == 30

    stream = db_session.query(Stream).filter(Stream.id == created["stream_id"]).first()
    assert stream is not None
    mapping = db_session.query(Mapping).filter(Mapping.stream_id == stream.id).first()
    assert mapping is not None
    assert mapping.field_mappings_json.get("event_id") == "$.detection_id"
    assert mapping.event_array_path == "$.resources"
    enrichment = db_session.query(Enrichment).filter(Enrichment.stream_id == stream.id).first()
    assert enrichment is not None
    assert enrichment.enrichment_json.get("vendor") == "CrowdStrike"
    checkpoint = db_session.query(Checkpoint).filter(Checkpoint.stream_id == stream.id).first()
    assert checkpoint is not None
    assert checkpoint.checkpoint_type == "CUSTOM_FIELD"
    assert "last_detection_id" in checkpoint.checkpoint_value_json
    assert db_session.query(Route).filter(Route.stream_id == stream.id).count() == 0


def test_materialize_multiple_templates(client: TestClient, db_session: Session) -> None:
    connector, _source = _seed_connector_with_source(db_session)
    res = client.post(
        "/api/v1/connector-templates/materialize",
        json={
            "connector_id": connector.id,
            "module_id": "crowdstrike",
            "templates": ["detections", "incidents"],
        },
    )
    assert res.status_code == 201
    assert len(res.json()["created_streams"]) == 2
    template_ids = {row["template_id"] for row in res.json()["created_streams"]}
    assert template_ids == {"detections", "incidents"}


def test_materialize_duplicate_template_rejected(client: TestClient, db_session: Session) -> None:
    connector, _source = _seed_connector_with_source(db_session)
    res = client.post(
        "/api/v1/connector-templates/materialize",
        json={
            "connector_id": connector.id,
            "module_id": "crowdstrike",
            "templates": ["detections", "detections"],
        },
    )
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["rule_id"] == "TPL-002"
    assert detail["error_code"] == "DUPLICATE_TEMPLATE"


def test_materialize_empty_template_id_rejected(client: TestClient, db_session: Session) -> None:
    connector, _source = _seed_connector_with_source(db_session)
    res = client.post(
        "/api/v1/connector-templates/materialize",
        json={
            "connector_id": connector.id,
            "module_id": "crowdstrike",
            "templates": [""],
        },
    )
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["rule_id"] == "TPL-001"


def test_materialize_invalid_template_rejected(client: TestClient, db_session: Session) -> None:
    connector, _source = _seed_connector_with_source(db_session)
    res = client.post(
        "/api/v1/connector-templates/materialize",
        json={
            "connector_id": connector.id,
            "module_id": "crowdstrike",
            "templates": ["does_not_exist"],
        },
    )
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["rule_id"] == "TPL-004"


def test_materialize_invalid_module_rejected(client: TestClient, db_session: Session) -> None:
    connector, _source = _seed_connector_with_source(db_session)
    res = client.post(
        "/api/v1/connector-templates/materialize",
        json={
            "connector_id": connector.id,
            "module_id": "wiz",
            "templates": ["issues"],
        },
    )
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["rule_id"] == "TPL-005"


def test_materialize_unknown_module_rejected(client: TestClient, db_session: Session) -> None:
    connector, _source = _seed_connector_with_source(db_session)
    res = client.post(
        "/api/v1/connector-templates/materialize",
        json={
            "connector_id": connector.id,
            "module_id": "unknown_module_xyz",
            "templates": ["events"],
        },
    )
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["rule_id"] == "TPL-005"


def test_materialize_connector_not_found(client: TestClient) -> None:
    res = client.post(
        "/api/v1/connector-templates/materialize",
        json={
            "connector_id": 999999,
            "module_id": "crowdstrike",
            "templates": ["detections"],
        },
    )
    assert res.status_code == 404
    assert res.json()["detail"]["error_code"] == "CONNECTOR_NOT_FOUND"
