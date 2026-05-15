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
def route_ui_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_get_route_ui_config_returns_route_destination_and_effective_fallbacks(
    route_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    route = db_session.query(Route).filter(Route.id == h["route_a_id"]).one()
    destination = db_session.query(Destination).filter(Destination.id == route.destination_id).one()
    route.formatter_config_json = {}
    route.rate_limit_json = {}
    destination.config_json = {
        "formatter_config": {"message_format": "json", "tag": "dest_tag"},
        "host": "10.0.0.1",
    }
    destination.rate_limit_json = {"max_per_second": 7}
    db_session.commit()

    r = route_ui_client.get(f"/api/v1/runtime/routes/{route.id}/ui/config")
    assert r.status_code == 200
    body = r.json()
    assert body["route"]["id"] == route.id
    assert body["route"]["destination_id"] == destination.id
    assert body["destination"]["id"] == destination.id
    assert body["destination"]["name"] == destination.name
    assert body["effective_formatter_config"]["tag"] == "dest_tag"
    assert body["effective_rate_limit"] == {"max_per_second": 7}


def test_get_route_ui_config_does_not_commit_or_rollback(
    monkeypatch: pytest.MonkeyPatch,
    route_ui_client: TestClient,
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
    r = route_ui_client.get(f"/api/v1/runtime/routes/{h['route_a_id']}/ui/config")
    assert r.status_code == 200
    assert called["commit"] == 0
    assert called["rollback"] == 0


def test_get_unknown_route_returns_404(route_ui_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    r = route_ui_client.get("/api/v1/runtime/routes/999999999/ui/config")
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "ROUTE_NOT_FOUND"


def test_post_route_ui_save_updates_route_fields(route_ui_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    route_id = h["route_a_id"]
    r = route_ui_client.post(
        f"/api/v1/runtime/routes/{route_id}/ui/save",
        json={
            "route_enabled": False,
            "route_formatter_config": {"message_format": "json", "tag": "route_tag"},
            "route_rate_limit": {"max_per_second": 3},
            "failure_policy": "PAUSE_STREAM_ON_FAILURE",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["route_enabled"] is False
    assert body["failure_policy"] == "PAUSE_STREAM_ON_FAILURE"
    assert body["formatter_config"]["tag"] == "route_tag"
    assert body["route_rate_limit"] == {"max_per_second": 3}


def test_post_route_ui_save_empty_route_rate_limit_returns_422(
    route_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    route_id = h["route_a_id"]
    r = route_ui_client.post(
        f"/api/v1/runtime/routes/{route_id}/ui/save",
        json={"route_rate_limit": {}},
    )
    assert r.status_code == 422


def test_post_route_ui_save_updates_destination_enabled_only(
    route_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    route_id = h["route_a_id"]
    r = route_ui_client.post(
        f"/api/v1/runtime/routes/{route_id}/ui/save",
        json={"destination_enabled": False},
    )
    assert r.status_code == 200
    assert r.json()["destination_enabled"] is False


def test_post_route_ui_save_commits_once_on_success(
    monkeypatch: pytest.MonkeyPatch,
    route_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    commits = {"n": 0}
    real_commit = Session.commit

    def _count_commit(self: Session, *args: Any, **kwargs: Any) -> None:
        commits["n"] += 1
        return real_commit(self, *args, **kwargs)

    monkeypatch.setattr(Session, "commit", _count_commit)
    r = route_ui_client.post(
        f"/api/v1/runtime/routes/{h['route_a_id']}/ui/save",
        json={"route_enabled": False},
    )
    assert r.status_code == 200
    assert commits["n"] == 1


def test_post_route_ui_save_does_not_commit_on_failure(
    monkeypatch: pytest.MonkeyPatch,
    route_ui_client: TestClient,
    db_session: Session,
) -> None:
    _seed_stream_two_routes(db_session)
    commits = {"n": 0}
    real_commit = Session.commit

    def _count_commit(self: Session, *args: Any, **kwargs: Any) -> None:
        commits["n"] += 1
        return real_commit(self, *args, **kwargs)

    monkeypatch.setattr(Session, "commit", _count_commit)
    r = route_ui_client.post("/api/v1/runtime/routes/999999999/ui/save", json={"route_enabled": False})
    assert r.status_code == 404
    assert commits["n"] == 0


def test_post_unknown_route_returns_404(route_ui_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    r = route_ui_client.post("/api/v1/runtime/routes/999999999/ui/save", json={"route_enabled": False})
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "ROUTE_NOT_FOUND"


def test_route_ui_save_does_not_modify_stream_source_checkpoint_delivery_logs(
    route_ui_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    route_id = h["route_a_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    source = db_session.query(Source).filter(Source.id == stream.source_id).one()
    checkpoint = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()
    _delivery_log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=sid,
        route_id=route_id,
        destination_id=h["dest_a_id"],
        stage="run_complete",
    )
    db_session.commit()
    before_stream = (bool(stream.enabled), stream.status, dict(stream.config_json or {}))
    before_source = dict(source.config_json or {})
    before_cp = (checkpoint.checkpoint_type, dict(checkpoint.checkpoint_value_json or {}))
    before_logs = db_session.query(DeliveryLog).count()

    r = route_ui_client.post(
        f"/api/v1/runtime/routes/{route_id}/ui/save",
        json={"route_formatter_config": {"tag": "x"}},
    )
    assert r.status_code == 200

    db_session.expire_all()
    stream2 = db_session.query(Stream).filter(Stream.id == sid).one()
    source2 = db_session.query(Source).filter(Source.id == source.id).one()
    checkpoint2 = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()
    assert (bool(stream2.enabled), stream2.status, dict(stream2.config_json or {})) == before_stream
    assert dict(source2.config_json or {}) == before_source
    assert (checkpoint2.checkpoint_type, dict(checkpoint2.checkpoint_value_json or {})) == before_cp
    assert db_session.query(DeliveryLog).count() == before_logs


def test_individual_save_endpoints_regression_still_work(route_ui_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    rid = h["route_a_id"]

    assert (
        route_ui_client.post(
            f"/api/v1/runtime/mappings/stream/{sid}/save",
            json={"field_mappings": {"event_id": "$.id"}},
        ).status_code
        == 200
    )
    assert (
        route_ui_client.post(
            f"/api/v1/runtime/enrichments/stream/{sid}/save",
            json={"enrichment": {"vendor": "Acme"}},
        ).status_code
        == 200
    )
    assert (
        route_ui_client.post(
            f"/api/v1/runtime/routes/{rid}/formatter/save",
            json={"formatter_config": {"message_format": "json"}},
        ).status_code
        == 200
    )


def test_preview_endpoints_regression_still_work(route_ui_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    assert (
        route_ui_client.post(
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
