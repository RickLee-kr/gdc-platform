from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
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
def destination_ui_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_get_destination_ui_config_returns_destination_fields(
    destination_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    did = h["dest_a_id"]
    dest = db_session.query(Destination).filter(Destination.id == did).one()
    dest.config_json = {"url": "https://example.com/hook"}
    dest.rate_limit_json = {"max_per_second": 12}
    db_session.commit()

    r = destination_ui_client.get(f"/api/v1/runtime/destinations/{did}/ui/config")
    assert r.status_code == 200
    body = r.json()
    assert body["destination"]["id"] == did
    assert body["destination"]["name"] == dest.name
    assert body["destination"]["destination_type"] == str(dest.destination_type)
    assert body["destination"]["enabled"] is True
    assert body["destination"]["config_json"]["url"] == "https://example.com/hook"
    assert body["destination"]["rate_limit_json"] == {"max_per_second": 12}


def test_get_destination_ui_config_returns_routes_using_destination(
    destination_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    did = h["dest_a_id"]
    stream = db_session.query(Stream).filter(Stream.id == h["stream_id"]).one()
    r = destination_ui_client.get(f"/api/v1/runtime/destinations/{did}/ui/config")
    assert r.status_code == 200
    body = r.json()
    assert len(body["routes"]) == 1
    route = body["routes"][0]
    assert route["id"] == h["route_a_id"]
    assert route["stream_id"] == h["stream_id"]
    assert route["stream_name"] == stream.name
    assert "failure_policy" in route
    assert "formatter_config_json" in route
    assert "rate_limit_json" in route


def test_get_destination_ui_config_does_not_commit_or_rollback(
    monkeypatch: pytest.MonkeyPatch,
    destination_ui_client: TestClient,
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
    r = destination_ui_client.get(f"/api/v1/runtime/destinations/{h['dest_a_id']}/ui/config")
    assert r.status_code == 200
    assert called["commit"] == 0
    assert called["rollback"] == 0


def test_get_unknown_destination_returns_404(destination_ui_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    r = destination_ui_client.get("/api/v1/runtime/destinations/999999999/ui/config")
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "DESTINATION_NOT_FOUND"


def test_post_destination_ui_save_updates_all_supported_fields(
    destination_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    did = h["dest_a_id"]
    r = destination_ui_client.post(
        f"/api/v1/runtime/destinations/{did}/ui/save",
        json={
            "name": "dest-updated",
            "enabled": False,
            "config_json": {"url": "https://updated.example.com/hook"},
            "rate_limit_json": {"max_per_second": 5},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["destination_id"] == did
    assert body["name"] == "dest-updated"
    assert body["enabled"] is False
    assert body["config_json"]["url"] == "https://updated.example.com/hook"
    assert body["rate_limit_json"] == {"max_per_second": 5}


def test_post_destination_ui_save_allows_empty_config_json(
    destination_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    did = h["dest_a_id"]
    r = destination_ui_client.post(
        f"/api/v1/runtime/destinations/{did}/ui/save",
        json={
            "name": "dest-empty-config",
            "enabled": True,
            "config_json": {},
            "rate_limit_json": {"max_per_second": 1},
        },
    )
    assert r.status_code == 200
    assert r.json()["config_json"] == {}


def test_post_destination_ui_save_allows_empty_rate_limit_json_and_persists_empty_object(
    destination_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    did = h["dest_a_id"]
    r = destination_ui_client.post(
        f"/api/v1/runtime/destinations/{did}/ui/save",
        json={
            "name": "dest-empty-rate-limit",
            "enabled": True,
            "config_json": {"url": "https://x"},
            "rate_limit_json": {},
        },
    )
    assert r.status_code == 200
    assert r.json()["rate_limit_json"] == {}
    db_session.expire_all()
    dest = db_session.query(Destination).filter(Destination.id == did).one()
    assert dict(dest.rate_limit_json or {}) == {}


def test_post_destination_ui_save_commits_once_on_success(
    monkeypatch: pytest.MonkeyPatch,
    destination_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    did = h["dest_a_id"]
    commits = {"n": 0}
    real_commit = Session.commit

    def _count_commit(self: Session, *args: Any, **kwargs: Any) -> None:
        commits["n"] += 1
        return real_commit(self, *args, **kwargs)

    monkeypatch.setattr(Session, "commit", _count_commit)
    r = destination_ui_client.post(
        f"/api/v1/runtime/destinations/{did}/ui/save",
        json={"name": "x", "enabled": True, "config_json": {}, "rate_limit_json": {}},
    )
    assert r.status_code == 200
    assert commits["n"] == 1


def test_post_destination_ui_save_does_not_commit_on_failure(
    monkeypatch: pytest.MonkeyPatch,
    destination_ui_client: TestClient,
    db_session: Session,
) -> None:
    _seed_stream_two_routes(db_session)
    commits = {"n": 0}
    real_commit = Session.commit

    def _count_commit(self: Session, *args: Any, **kwargs: Any) -> None:
        commits["n"] += 1
        return real_commit(self, *args, **kwargs)

    monkeypatch.setattr(Session, "commit", _count_commit)
    r = destination_ui_client.post(
        "/api/v1/runtime/destinations/999999999/ui/save",
        json={"name": "x", "enabled": True, "config_json": {}, "rate_limit_json": {}},
    )
    assert r.status_code == 404
    assert commits["n"] == 0


def test_post_unknown_destination_returns_404(destination_ui_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    r = destination_ui_client.post(
        "/api/v1/runtime/destinations/999999999/ui/save",
        json={"name": "x", "enabled": True, "config_json": {}, "rate_limit_json": {}},
    )
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "DESTINATION_NOT_FOUND"


def test_destination_ui_save_does_not_modify_route_stream_source_checkpoint_delivery_logs(
    destination_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    rid = h["route_a_id"]
    did = h["dest_a_id"]
    route = db_session.query(Route).filter(Route.id == rid).one()
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    source = db_session.query(Source).filter(Source.id == stream.source_id).one()
    checkpoint = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()
    _delivery_log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=sid,
        route_id=rid,
        destination_id=did,
        stage="run_complete",
    )
    db_session.commit()
    before_route = (
        bool(route.enabled),
        str(route.failure_policy),
        dict(route.formatter_config_json or {}),
        dict(route.rate_limit_json or {}),
    )
    before_stream = (bool(stream.enabled), stream.status, dict(stream.config_json or {}))
    before_source = dict(source.config_json or {})
    before_checkpoint = (checkpoint.checkpoint_type, dict(checkpoint.checkpoint_value_json or {}))
    before_logs = db_session.query(DeliveryLog).count()

    r = destination_ui_client.post(
        f"/api/v1/runtime/destinations/{did}/ui/save",
        json={"name": "dest-keep", "enabled": True, "config_json": {"url": "https://x"}, "rate_limit_json": {}},
    )
    assert r.status_code == 200

    db_session.expire_all()
    route2 = db_session.query(Route).filter(Route.id == rid).one()
    stream2 = db_session.query(Stream).filter(Stream.id == sid).one()
    source2 = db_session.query(Source).filter(Source.id == source.id).one()
    checkpoint2 = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()
    assert (
        bool(route2.enabled),
        str(route2.failure_policy),
        dict(route2.formatter_config_json or {}),
        dict(route2.rate_limit_json or {}),
    ) == before_route
    assert (bool(stream2.enabled), stream2.status, dict(stream2.config_json or {})) == before_stream
    assert dict(source2.config_json or {}) == before_source
    assert (checkpoint2.checkpoint_type, dict(checkpoint2.checkpoint_value_json or {})) == before_checkpoint
    assert db_session.query(DeliveryLog).count() == before_logs


def test_existing_route_ui_apis_still_pass(destination_ui_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    assert destination_ui_client.get(f"/api/v1/runtime/routes/{rid}/ui/config").status_code == 200
    assert (
        destination_ui_client.post(
            f"/api/v1/runtime/routes/{rid}/ui/save",
            json={"route_enabled": False},
        ).status_code
        == 200
    )


def test_existing_preview_endpoints_still_pass(destination_ui_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    assert (
        destination_ui_client.post(
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
