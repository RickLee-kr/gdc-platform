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
def connector_ui_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_get_connector_ui_config_returns_connector_fields(
    connector_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    connector = db_session.query(Connector).filter(Connector.id == h["connector_id"]).one()

    r = connector_ui_client.get(f"/api/v1/runtime/connectors/{connector.id}/ui/config")
    assert r.status_code == 200
    body = r.json()
    assert body["connector"]["id"] == connector.id
    assert body["connector"]["name"] == connector.name
    assert body["connector"]["description"] == connector.description
    assert body["connector"]["status"] == connector.status


def test_get_connector_ui_config_returns_source_summaries(
    connector_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    connector = db_session.query(Connector).filter(Connector.id == h["connector_id"]).one()
    stream = db_session.query(Stream).filter(Stream.id == h["stream_id"]).one()
    source = db_session.query(Source).filter(Source.id == stream.source_id).one()

    r = connector_ui_client.get(f"/api/v1/runtime/connectors/{connector.id}/ui/config")
    assert r.status_code == 200
    sources = r.json()["sources"]
    assert len(sources) == 1
    assert sources[0]["id"] == source.id
    assert sources[0]["source_type"] == source.source_type
    assert sources[0]["enabled"] == bool(source.enabled)
    assert sources[0]["stream_count"] == 1


def test_get_connector_ui_config_returns_stream_summaries(
    connector_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    connector = db_session.query(Connector).filter(Connector.id == h["connector_id"]).one()
    stream = db_session.query(Stream).filter(Stream.id == h["stream_id"]).one()

    r = connector_ui_client.get(f"/api/v1/runtime/connectors/{connector.id}/ui/config")
    assert r.status_code == 200
    streams = r.json()["streams"]
    assert len(streams) == 1
    assert streams[0]["id"] == stream.id
    assert streams[0]["source_id"] == stream.source_id
    assert streams[0]["name"] == stream.name
    assert streams[0]["stream_type"] == stream.stream_type
    assert streams[0]["enabled"] == bool(stream.enabled)
    assert streams[0]["status"] == stream.status
    assert streams[0]["polling_interval"] == stream.polling_interval
    assert streams[0]["route_count"] == 2


def test_get_connector_ui_config_returns_summary_counts(
    connector_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    connector = db_session.query(Connector).filter(Connector.id == h["connector_id"]).one()
    r = connector_ui_client.get(f"/api/v1/runtime/connectors/{connector.id}/ui/config")
    assert r.status_code == 200
    summary = r.json()["summary"]
    assert summary["source_count"] == 1
    assert summary["stream_count"] == 1
    assert summary["enabled_stream_count"] == 1
    assert summary["route_count"] == 2


def test_get_connector_ui_config_does_not_commit_or_rollback(
    monkeypatch: pytest.MonkeyPatch,
    connector_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    called = {"commit": 0, "rollback": 0}

    def _count_commit(*args, **kwargs):  # noqa: ANN002, ANN003
        called["commit"] += 1

    def _count_rollback(*args, **kwargs):  # noqa: ANN002, ANN003
        called["rollback"] += 1

    monkeypatch.setattr("sqlalchemy.orm.session.Session.commit", _count_commit)
    monkeypatch.setattr("sqlalchemy.orm.session.Session.rollback", _count_rollback)
    r = connector_ui_client.get(f"/api/v1/runtime/connectors/{h['connector_id']}/ui/config")
    assert r.status_code == 200
    assert called["commit"] == 0
    assert called["rollback"] == 0


def test_get_unknown_connector_returns_404(connector_ui_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    r = connector_ui_client.get("/api/v1/runtime/connectors/999999999/ui/config")
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "CONNECTOR_NOT_FOUND"


def test_post_connector_ui_save_updates_name_description_status(
    connector_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    cid = h["connector_id"]
    r = connector_ui_client.post(
        f"/api/v1/runtime/connectors/{cid}/ui/save",
        json={"name": "new-name", "description": "new-desc", "status": "RUNNING"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["connector_id"] == cid
    assert body["name"] == "new-name"
    assert body["description"] == "new-desc"
    assert body["status"] == "RUNNING"


def test_post_connector_ui_save_commits_once_on_success(
    monkeypatch: pytest.MonkeyPatch,
    connector_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    commits = {"n": 0}
    real_commit = Session.commit

    def _count_commit(self: Session, *args: Any, **kwargs: Any) -> None:
        commits["n"] += 1
        return real_commit(self, *args, **kwargs)

    monkeypatch.setattr(Session, "commit", _count_commit)
    r = connector_ui_client.post(
        f"/api/v1/runtime/connectors/{h['connector_id']}/ui/save",
        json={"name": "connector-a", "description": "desc", "status": "STOPPED"},
    )
    assert r.status_code == 200
    assert commits["n"] == 1


def test_post_connector_ui_save_does_not_commit_on_failure(
    monkeypatch: pytest.MonkeyPatch,
    connector_ui_client: TestClient,
    db_session: Session,
) -> None:
    _seed_stream_two_routes(db_session)
    commits = {"n": 0}
    real_commit = Session.commit

    def _count_commit(self: Session, *args: Any, **kwargs: Any) -> None:
        commits["n"] += 1
        return real_commit(self, *args, **kwargs)

    monkeypatch.setattr(Session, "commit", _count_commit)
    r = connector_ui_client.post(
        "/api/v1/runtime/connectors/999999999/ui/save",
        json={"name": "connector-a", "description": "desc", "status": "STOPPED"},
    )
    assert r.status_code == 404
    assert commits["n"] == 0


def test_post_unknown_connector_returns_404(connector_ui_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    r = connector_ui_client.post(
        "/api/v1/runtime/connectors/999999999/ui/save",
        json={"name": "connector-a", "description": "desc", "status": "STOPPED"},
    )
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "CONNECTOR_NOT_FOUND"


def test_connector_ui_save_does_not_modify_other_entities(
    connector_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    connector = db_session.query(Connector).filter(Connector.id == h["connector_id"]).one()
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    source = db_session.query(Source).filter(Source.id == stream.source_id).one()
    db_session.add(
        Mapping(
            stream_id=sid,
            event_array_path="$.items",
            field_mappings_json={"event_id": "$.id"},
            raw_payload_mode="JSON_TREE",
        )
    )
    db_session.add(
        Enrichment(
            stream_id=sid,
            enrichment_json={"vendor": "Acme"},
            override_policy="KEEP_EXISTING",
            enabled=True,
        )
    )
    db_session.commit()
    route = db_session.query(Route).filter(Route.id == h["route_a_id"]).one()
    destination = db_session.query(Destination).filter(Destination.id == h["dest_a_id"]).one()
    checkpoint = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()
    _delivery_log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=sid,
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="run_complete",
    )
    db_session.commit()

    before_source = (
        source.source_type,
        bool(source.enabled),
        dict(source.config_json or {}),
        dict(source.auth_json or {}),
    )
    before_stream = (
        stream.source_id,
        stream.name,
        stream.stream_type,
        bool(stream.enabled),
        stream.status,
        stream.polling_interval,
        dict(stream.config_json or {}),
        dict(stream.rate_limit_json or {}),
    )
    mapping = db_session.query(Mapping).filter(Mapping.stream_id == sid).one()
    before_mapping = (mapping.event_array_path, dict(mapping.field_mappings_json or {}), mapping.raw_payload_mode)
    enrichment = db_session.query(Enrichment).filter(Enrichment.stream_id == sid).one()
    before_enrichment = (bool(enrichment.enabled), dict(enrichment.enrichment_json or {}), str(enrichment.override_policy))
    before_route = (
        bool(route.enabled),
        str(route.failure_policy),
        dict(route.formatter_config_json or {}),
        dict(route.rate_limit_json or {}),
    )
    before_destination = (
        destination.name,
        bool(destination.enabled),
        dict(destination.config_json or {}),
        dict(destination.rate_limit_json or {}),
    )
    before_checkpoint = (checkpoint.checkpoint_type, dict(checkpoint.checkpoint_value_json or {}))
    before_logs = db_session.query(DeliveryLog).count()

    r = connector_ui_client.post(
        f"/api/v1/runtime/connectors/{connector.id}/ui/save",
        json={"name": "connector-renamed", "description": "updated", "status": "RUNNING"},
    )
    assert r.status_code == 200

    db_session.expire_all()
    source2 = db_session.query(Source).filter(Source.id == source.id).one()
    stream2 = db_session.query(Stream).filter(Stream.id == sid).one()
    mapping2 = db_session.query(Mapping).filter(Mapping.stream_id == sid).one()
    enrichment2 = db_session.query(Enrichment).filter(Enrichment.stream_id == sid).one()
    route2 = db_session.query(Route).filter(Route.id == h["route_a_id"]).one()
    destination2 = db_session.query(Destination).filter(Destination.id == h["dest_a_id"]).one()
    checkpoint2 = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()

    assert (
        source2.source_type,
        bool(source2.enabled),
        dict(source2.config_json or {}),
        dict(source2.auth_json or {}),
    ) == before_source
    assert (
        stream2.source_id,
        stream2.name,
        stream2.stream_type,
        bool(stream2.enabled),
        stream2.status,
        stream2.polling_interval,
        dict(stream2.config_json or {}),
        dict(stream2.rate_limit_json or {}),
    ) == before_stream
    assert (
        mapping2.event_array_path,
        dict(mapping2.field_mappings_json or {}),
        mapping2.raw_payload_mode,
    ) == before_mapping
    assert (
        bool(enrichment2.enabled),
        dict(enrichment2.enrichment_json or {}),
        str(enrichment2.override_policy),
    ) == before_enrichment
    assert (
        bool(route2.enabled),
        str(route2.failure_policy),
        dict(route2.formatter_config_json or {}),
        dict(route2.rate_limit_json or {}),
    ) == before_route
    assert (
        destination2.name,
        bool(destination2.enabled),
        dict(destination2.config_json or {}),
        dict(destination2.rate_limit_json or {}),
    ) == before_destination
    assert (checkpoint2.checkpoint_type, dict(checkpoint2.checkpoint_value_json or {})) == before_checkpoint
    assert db_session.query(DeliveryLog).count() == before_logs


def test_existing_ui_and_preview_apis_still_pass(connector_ui_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    rid = h["route_a_id"]
    did = h["dest_a_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    source_id = int(stream.source_id)

    assert connector_ui_client.get(f"/api/v1/runtime/sources/{source_id}/ui/config").status_code == 200
    assert connector_ui_client.get(f"/api/v1/runtime/streams/{sid}/ui/config").status_code == 200
    assert connector_ui_client.get(f"/api/v1/runtime/streams/{sid}/mapping-ui/config").status_code == 200
    assert connector_ui_client.get(f"/api/v1/runtime/routes/{rid}/ui/config").status_code == 200
    assert connector_ui_client.get(f"/api/v1/runtime/destinations/{did}/ui/config").status_code == 200
    assert (
        connector_ui_client.post(
            "/api/v1/runtime/preview/mapping",
            json={
                "raw_response": {"items": [{"id": "evt-1"}]},
                "event_array_path": "$.items",
                "field_mappings": {"event_id": "$.id"},
                "enrichment": {},
                "override_policy": "KEEP_EXISTING",
            },
        ).status_code
        == 200
    )
