from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
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
def source_ui_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_get_source_ui_config_returns_source_fields(source_ui_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    source = db_session.query(Source).filter(Source.id == stream.source_id).one()
    source.config_json = {"url": "https://api.example.com"}
    source.auth_json = {"token": "abc"}
    db_session.commit()

    r = source_ui_client.get(f"/api/v1/runtime/sources/{source.id}/ui/config")
    assert r.status_code == 200
    body = r.json()
    s = body["source"]
    assert s["id"] == source.id
    assert s["connector_id"] == source.connector_id
    assert s["source_type"] == source.source_type
    assert s["enabled"] == bool(source.enabled)
    assert s["config_json"] == {"url": "https://api.example.com"}
    assert s["auth_json"] == {"token": "********"}


def test_get_source_ui_config_returns_streams_using_source(
    source_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    source = db_session.query(Source).filter(Source.id == stream.source_id).one()

    r = source_ui_client.get(f"/api/v1/runtime/sources/{source.id}/ui/config")
    assert r.status_code == 200
    body = r.json()
    assert len(body["streams"]) == 1
    s = body["streams"][0]
    assert s["id"] == stream.id
    assert s["name"] == stream.name
    assert s["stream_type"] == stream.stream_type
    assert s["enabled"] == bool(stream.enabled)
    assert s["status"] == stream.status
    assert s["polling_interval"] == stream.polling_interval
    assert s["config_json"] == dict(stream.config_json or {})
    assert s["rate_limit_json"] == dict(stream.rate_limit_json or {})


def test_get_source_ui_config_includes_route_count_per_stream(
    source_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    source = db_session.query(Source).filter(Source.id == stream.source_id).one()

    r = source_ui_client.get(f"/api/v1/runtime/sources/{source.id}/ui/config")
    assert r.status_code == 200
    assert r.json()["streams"][0]["route_count"] == 2


def test_get_source_ui_config_does_not_commit_or_rollback(
    monkeypatch: pytest.MonkeyPatch,
    source_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    called = {"commit": 0, "rollback": 0}

    def _count_commit(*args, **kwargs):  # noqa: ANN002, ANN003
        called["commit"] += 1

    def _count_rollback(*args, **kwargs):  # noqa: ANN002, ANN003
        called["rollback"] += 1

    monkeypatch.setattr("sqlalchemy.orm.session.Session.commit", _count_commit)
    monkeypatch.setattr("sqlalchemy.orm.session.Session.rollback", _count_rollback)
    r = source_ui_client.get(f"/api/v1/runtime/sources/{stream.source_id}/ui/config")
    assert r.status_code == 200
    assert called["commit"] == 0
    assert called["rollback"] == 0


def test_get_unknown_source_returns_404(source_ui_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    r = source_ui_client.get("/api/v1/runtime/sources/999999999/ui/config")
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "SOURCE_NOT_FOUND"


def test_post_source_ui_save_updates_enabled_config_auth(
    source_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    source_id = stream.source_id
    r = source_ui_client.post(
        f"/api/v1/runtime/sources/{source_id}/ui/save",
        json={"enabled": False, "config_json": {"url": "https://new"}, "auth_json": {"token": "zzz"}},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["source_id"] == source_id
    assert body["enabled"] is False
    assert body["config_json"] == {"url": "https://new"}
    assert body["auth_json"] == {"token": "********"}


def test_post_source_ui_save_allows_empty_config_json_and_persists_empty_object(
    source_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    source_id = stream.source_id
    r = source_ui_client.post(
        f"/api/v1/runtime/sources/{source_id}/ui/save",
        json={"enabled": True, "config_json": {}, "auth_json": {"token": "x"}},
    )
    assert r.status_code == 200
    assert r.json()["config_json"] == {}
    db_session.expire_all()
    source = db_session.query(Source).filter(Source.id == source_id).one()
    assert dict(source.config_json or {}) == {}


def test_post_source_ui_save_allows_empty_auth_json_and_persists_empty_object(
    source_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    source_id = stream.source_id
    r = source_ui_client.post(
        f"/api/v1/runtime/sources/{source_id}/ui/save",
        json={"enabled": True, "config_json": {"url": "https://x"}, "auth_json": {}},
    )
    assert r.status_code == 200
    assert r.json()["auth_json"] == {}
    db_session.expire_all()
    source = db_session.query(Source).filter(Source.id == source_id).one()
    assert dict(source.auth_json or {}) == {}


def test_post_source_ui_save_commits_once_on_success(
    monkeypatch: pytest.MonkeyPatch,
    source_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    source_id = stream.source_id
    commits = {"n": 0}
    real_commit = Session.commit

    def _count_commit(self: Session, *args: Any, **kwargs: Any) -> None:
        commits["n"] += 1
        return real_commit(self, *args, **kwargs)

    monkeypatch.setattr(Session, "commit", _count_commit)
    r = source_ui_client.post(
        f"/api/v1/runtime/sources/{source_id}/ui/save",
        json={"enabled": True, "config_json": {}, "auth_json": {}},
    )
    assert r.status_code == 200
    assert commits["n"] == 1


def test_post_source_ui_save_does_not_commit_on_failure(
    monkeypatch: pytest.MonkeyPatch,
    source_ui_client: TestClient,
    db_session: Session,
) -> None:
    _seed_stream_two_routes(db_session)
    commits = {"n": 0}
    real_commit = Session.commit

    def _count_commit(self: Session, *args: Any, **kwargs: Any) -> None:
        commits["n"] += 1
        return real_commit(self, *args, **kwargs)

    monkeypatch.setattr(Session, "commit", _count_commit)
    r = source_ui_client.post(
        "/api/v1/runtime/sources/999999999/ui/save",
        json={"enabled": True, "config_json": {}, "auth_json": {}},
    )
    assert r.status_code == 404
    assert commits["n"] == 0


def test_post_unknown_source_returns_404(source_ui_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    r = source_ui_client.post(
        "/api/v1/runtime/sources/999999999/ui/save",
        json={"enabled": True, "config_json": {}, "auth_json": {}},
    )
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "SOURCE_NOT_FOUND"


def test_source_ui_save_does_not_modify_other_entities(source_ui_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
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
    before_stream = (
        stream.name,
        bool(stream.enabled),
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

    r = source_ui_client.post(
        f"/api/v1/runtime/sources/{source.id}/ui/save",
        json={"enabled": False, "config_json": {"url": "https://changed"}, "auth_json": {"token": "changed"}},
    )
    assert r.status_code == 200

    db_session.expire_all()
    stream2 = db_session.query(Stream).filter(Stream.id == sid).one()
    mapping2 = db_session.query(Mapping).filter(Mapping.stream_id == sid).one()
    enrichment2 = db_session.query(Enrichment).filter(Enrichment.stream_id == sid).one()
    route2 = db_session.query(Route).filter(Route.id == h["route_a_id"]).one()
    destination2 = db_session.query(Destination).filter(Destination.id == h["dest_a_id"]).one()
    checkpoint2 = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()
    assert (
        stream2.name,
        bool(stream2.enabled),
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


def test_existing_ui_and_preview_apis_still_pass(source_ui_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    rid = h["route_a_id"]
    did = h["dest_a_id"]

    assert source_ui_client.get(f"/api/v1/runtime/streams/{sid}/ui/config").status_code == 200
    assert source_ui_client.get(f"/api/v1/runtime/streams/{sid}/mapping-ui/config").status_code == 200
    assert source_ui_client.get(f"/api/v1/runtime/routes/{rid}/ui/config").status_code == 200
    assert source_ui_client.get(f"/api/v1/runtime/destinations/{did}/ui/config").status_code == 200
    assert (
        source_ui_client.post(
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
