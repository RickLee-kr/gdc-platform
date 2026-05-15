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
def stream_ui_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_get_stream_ui_config_returns_stream_fields(stream_ui_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    stream.config_json = {"endpoint": "/events"}
    stream.rate_limit_json = {"max_requests": 50}
    db_session.commit()

    r = stream_ui_client.get(f"/api/v1/runtime/streams/{sid}/ui/config")
    assert r.status_code == 200
    body = r.json()
    s = body["stream"]
    assert s["id"] == sid
    assert s["connector_id"] == h["connector_id"]
    assert s["source_id"] == stream.source_id
    assert s["name"] == stream.name
    assert s["stream_type"] == stream.stream_type
    assert s["enabled"] == bool(stream.enabled)
    assert s["status"] == stream.status
    assert s["polling_interval"] == stream.polling_interval
    assert s["config_json"] == {"endpoint": "/events"}
    assert s["rate_limit_json"] == {"max_requests": 50}


def test_get_stream_ui_config_returns_source_summary(stream_ui_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    source = db_session.query(Source).filter(Source.id == stream.source_id).one()

    r = stream_ui_client.get(f"/api/v1/runtime/streams/{sid}/ui/config")
    assert r.status_code == 200
    src = r.json()["source"]
    assert src["id"] == source.id
    assert src["source_type"] == source.source_type
    assert src["enabled"] == bool(source.enabled)
    assert src["config_json"] == dict(source.config_json or {})


def test_get_stream_ui_config_returns_mapping_enrichment_routes_summaries(
    stream_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
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

    r = stream_ui_client.get(f"/api/v1/runtime/streams/{sid}/ui/config")
    assert r.status_code == 200
    body = r.json()
    assert body["mapping"]["exists"] is True
    assert body["mapping"]["event_array_path"] == "$.items"
    assert body["mapping"]["raw_payload_mode"] == "JSON_TREE"
    assert body["enrichment"]["exists"] is True
    assert body["enrichment"]["enabled"] is True
    assert body["enrichment"]["override_policy"] == "KEEP_EXISTING"
    assert len(body["routes"]) == 2
    assert all("failure_policy" in item for item in body["routes"])


def test_get_stream_ui_config_does_not_commit_or_rollback(
    monkeypatch: pytest.MonkeyPatch,
    stream_ui_client: TestClient,
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
    r = stream_ui_client.get(f"/api/v1/runtime/streams/{h['stream_id']}/ui/config")
    assert r.status_code == 200
    assert called["commit"] == 0
    assert called["rollback"] == 0


def test_get_unknown_stream_returns_404(stream_ui_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    r = stream_ui_client.get("/api/v1/runtime/streams/999999999/ui/config")
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "STREAM_NOT_FOUND"


def test_post_stream_ui_save_updates_stream_fields(stream_ui_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    r = stream_ui_client.post(
        f"/api/v1/runtime/streams/{sid}/ui/save",
        json={
            "name": "stream-updated",
            "enabled": False,
            "polling_interval": 120,
            "config_json": {"endpoint": "/new"},
            "rate_limit_json": {"max_requests": 88},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["stream_id"] == sid
    assert body["name"] == "stream-updated"
    assert body["enabled"] is False
    assert body["polling_interval"] == 120
    assert body["config_json"] == {"endpoint": "/new"}
    assert body["rate_limit_json"] == {"max_requests": 88}


def test_post_stream_ui_save_allows_empty_config_json(
    stream_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    r = stream_ui_client.post(
        f"/api/v1/runtime/streams/{sid}/ui/save",
        json={
            "name": "stream-empty-config",
            "enabled": True,
            "polling_interval": 60,
            "config_json": {},
            "rate_limit_json": {"max_requests": 10},
        },
    )
    assert r.status_code == 200
    assert r.json()["config_json"] == {}


def test_post_stream_ui_save_allows_empty_rate_limit_json_and_persists_empty_object(
    stream_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    r = stream_ui_client.post(
        f"/api/v1/runtime/streams/{sid}/ui/save",
        json={
            "name": "stream-empty-rate-limit",
            "enabled": True,
            "polling_interval": 60,
            "config_json": {"endpoint": "/x"},
            "rate_limit_json": {},
        },
    )
    assert r.status_code == 200
    assert r.json()["rate_limit_json"] == {}
    db_session.expire_all()
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    assert dict(stream.rate_limit_json or {}) == {}


def test_post_stream_ui_save_commits_once_on_success(
    monkeypatch: pytest.MonkeyPatch,
    stream_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    commits = {"n": 0}
    real_commit = Session.commit

    def _count_commit(self: Session, *args: Any, **kwargs: Any) -> None:
        commits["n"] += 1
        return real_commit(self, *args, **kwargs)

    monkeypatch.setattr(Session, "commit", _count_commit)
    r = stream_ui_client.post(
        f"/api/v1/runtime/streams/{sid}/ui/save",
        json={"name": "s", "enabled": True, "polling_interval": 60, "config_json": {}, "rate_limit_json": {}},
    )
    assert r.status_code == 200
    assert commits["n"] == 1


def test_post_stream_ui_save_does_not_commit_on_failure(
    monkeypatch: pytest.MonkeyPatch,
    stream_ui_client: TestClient,
    db_session: Session,
) -> None:
    _seed_stream_two_routes(db_session)
    commits = {"n": 0}
    real_commit = Session.commit

    def _count_commit(self: Session, *args: Any, **kwargs: Any) -> None:
        commits["n"] += 1
        return real_commit(self, *args, **kwargs)

    monkeypatch.setattr(Session, "commit", _count_commit)
    r = stream_ui_client.post(
        "/api/v1/runtime/streams/999999999/ui/save",
        json={"name": "s", "enabled": True, "polling_interval": 60, "config_json": {}, "rate_limit_json": {}},
    )
    assert r.status_code == 404
    assert commits["n"] == 0


def test_post_unknown_stream_returns_404(stream_ui_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    r = stream_ui_client.post(
        "/api/v1/runtime/streams/999999999/ui/save",
        json={"name": "s", "enabled": True, "polling_interval": 60, "config_json": {}, "rate_limit_json": {}},
    )
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "STREAM_NOT_FOUND"


def test_stream_ui_save_does_not_modify_related_entities(stream_ui_client: TestClient, db_session: Session) -> None:
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
    before_source = (bool(source.enabled), dict(source.config_json or {}))
    before_mapping = db_session.query(Mapping).filter(Mapping.stream_id == sid).one()
    before_mapping_tuple = (
        before_mapping.event_array_path,
        dict(before_mapping.field_mappings_json or {}),
        before_mapping.raw_payload_mode,
    )
    before_enrichment = db_session.query(Enrichment).filter(Enrichment.stream_id == sid).one()
    before_enrichment_tuple = (
        bool(before_enrichment.enabled),
        dict(before_enrichment.enrichment_json or {}),
        str(before_enrichment.override_policy),
    )
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

    r = stream_ui_client.post(
        f"/api/v1/runtime/streams/{sid}/ui/save",
        json={
            "name": "stream-ui-save",
            "enabled": True,
            "polling_interval": 90,
            "config_json": {"endpoint": "/stream-ui"},
            "rate_limit_json": {"max_requests": 30},
        },
    )
    assert r.status_code == 200

    db_session.expire_all()
    source2 = db_session.query(Source).filter(Source.id == source.id).one()
    mapping2 = db_session.query(Mapping).filter(Mapping.stream_id == sid).one()
    enrichment2 = db_session.query(Enrichment).filter(Enrichment.stream_id == sid).one()
    route2 = db_session.query(Route).filter(Route.id == h["route_a_id"]).one()
    destination2 = db_session.query(Destination).filter(Destination.id == h["dest_a_id"]).one()
    checkpoint2 = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()

    assert (bool(source2.enabled), dict(source2.config_json or {})) == before_source
    assert (
        mapping2.event_array_path,
        dict(mapping2.field_mappings_json or {}),
        mapping2.raw_payload_mode,
    ) == before_mapping_tuple
    assert (
        bool(enrichment2.enabled),
        dict(enrichment2.enrichment_json or {}),
        str(enrichment2.override_policy),
    ) == before_enrichment_tuple
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


def test_existing_ui_and_preview_apis_still_pass(stream_ui_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    rid = h["route_a_id"]
    did = h["dest_a_id"]

    assert stream_ui_client.get(f"/api/v1/runtime/streams/{sid}/mapping-ui/config").status_code == 200
    assert stream_ui_client.get(f"/api/v1/runtime/routes/{rid}/ui/config").status_code == 200
    assert stream_ui_client.get(f"/api/v1/runtime/destinations/{did}/ui/config").status_code == 200
    assert (
        stream_ui_client.post(
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
