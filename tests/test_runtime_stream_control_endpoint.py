"""Runtime stream start/stop control API — stream enabled/status only."""

from __future__ import annotations

from typing import Any

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
def control_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_start_success(control_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.query(Stream).filter(Stream.id == sid).update({"enabled": False, "status": "STOPPED"})
    db_session.commit()

    r = control_client.post(f"/api/v1/runtime/streams/{sid}/start")
    assert r.status_code == 200
    body = r.json()
    assert body["stream_id"] == sid
    assert body["enabled"] is True
    assert body["status"] == "RUNNING"
    assert body["action"] == "start"

    row = db_session.query(Stream).filter(Stream.id == sid).one()
    assert row.enabled is True
    assert row.status == "RUNNING"


def test_stop_success(control_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.query(Stream).filter(Stream.id == sid).update({"enabled": True, "status": "RUNNING"})
    db_session.commit()

    r = control_client.post(f"/api/v1/runtime/streams/{sid}/stop")
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is False
    assert body["status"] == "STOPPED"
    assert body["action"] == "stop"

    row = db_session.query(Stream).filter(Stream.id == sid).one()
    assert row.enabled is False
    assert row.status == "STOPPED"


def test_start_idempotent(control_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.query(Stream).filter(Stream.id == sid).update({"enabled": True, "status": "RUNNING"})
    db_session.commit()

    assert control_client.post(f"/api/v1/runtime/streams/{sid}/start").status_code == 200
    r2 = control_client.post(f"/api/v1/runtime/streams/{sid}/start")
    assert r2.status_code == 200
    assert r2.json()["status"] == "RUNNING"
    row = db_session.query(Stream).filter(Stream.id == sid).one()
    assert row.enabled is True
    assert row.status == "RUNNING"


def test_stop_idempotent(control_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.query(Stream).filter(Stream.id == sid).update({"enabled": False, "status": "STOPPED"})
    db_session.commit()

    assert control_client.post(f"/api/v1/runtime/streams/{sid}/stop").status_code == 200
    r2 = control_client.post(f"/api/v1/runtime/streams/{sid}/stop")
    assert r2.status_code == 200
    assert r2.json()["status"] == "STOPPED"
    row = db_session.query(Stream).filter(Stream.id == sid).one()
    assert row.enabled is False
    assert row.status == "STOPPED"


def test_start_from_paused(control_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.query(Stream).filter(Stream.id == sid).update({"enabled": False, "status": "PAUSED"})
    db_session.commit()

    r = control_client.post(f"/api/v1/runtime/streams/{sid}/start")
    assert r.status_code == 200
    row = db_session.query(Stream).filter(Stream.id == sid).one()
    assert row.enabled is True
    assert row.status == "RUNNING"


def test_start_from_error(control_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.query(Stream).filter(Stream.id == sid).update({"enabled": False, "status": "ERROR"})
    db_session.commit()

    r = control_client.post(f"/api/v1/runtime/streams/{sid}/start")
    assert r.status_code == 200
    row = db_session.query(Stream).filter(Stream.id == sid).one()
    assert row.status == "RUNNING"


def test_stream_not_found(control_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    db_session.commit()

    r = control_client.post("/api/v1/runtime/streams/999999999/start")
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "STREAM_NOT_FOUND"


def test_commit_once_per_request(
    monkeypatch: pytest.MonkeyPatch,
    control_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.commit()

    commits = {"n": 0}
    real_commit = Session.commit

    def _count_commit(self: Session, *args: Any, **kwargs: Any) -> None:
        commits["n"] += 1
        return real_commit(self, *args, **kwargs)

    monkeypatch.setattr(Session, "commit", _count_commit)

    assert control_client.post(f"/api/v1/runtime/streams/{sid}/start").status_code == 200
    assert commits["n"] == 1


def test_no_explicit_rollback_from_handler(
    monkeypatch: pytest.MonkeyPatch,
    control_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.commit()

    rollbacks = {"n": 0}
    real_rb = Session.rollback

    def _count_rb(self: Session, *args: Any, **kwargs: Any) -> None:
        rollbacks["n"] += 1
        return real_rb(self, *args, **kwargs)

    monkeypatch.setattr(Session, "rollback", _count_rb)

    assert control_client.post(f"/api/v1/runtime/streams/{sid}/start").status_code == 200
    assert rollbacks["n"] == 0


def test_checkpoint_unchanged(control_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    cp = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()
    before_type = cp.checkpoint_type
    before_val = dict(cp.checkpoint_value_json or {})
    db_session.query(Stream).filter(Stream.id == sid).update({"enabled": False, "status": "STOPPED"})
    db_session.commit()

    assert control_client.post(f"/api/v1/runtime/streams/{sid}/start").status_code == 200

    db_session.expire_all()
    cp2 = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()
    assert cp2.checkpoint_type == before_type
    assert dict(cp2.checkpoint_value_json or {}) == before_val


def test_delivery_logs_count_unchanged(control_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    _delivery_log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=sid,
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="run_complete",
    )
    db_session.commit()
    before = db_session.query(DeliveryLog).count()

    assert control_client.post(f"/api/v1/runtime/streams/{sid}/start").status_code == 200

    assert db_session.query(DeliveryLog).count() == before


def test_route_source_destination_unchanged(control_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    src = db_session.query(Source).filter(Source.id == stream.source_id).one()
    route = db_session.query(Route).filter(Route.stream_id == sid).first()
    dest = db_session.query(Destination).filter(Destination.id == route.destination_id).one()

    r_enabled = bool(route.enabled)
    src_cfg = dict(src.config_json or {})
    dest_name = dest.name

    assert control_client.post(f"/api/v1/runtime/streams/{sid}/start").status_code == 200

    db_session.expire_all()
    route2 = db_session.query(Route).filter(Route.id == route.id).one()
    src2 = db_session.query(Source).filter(Source.id == src.id).one()
    dest2 = db_session.query(Destination).filter(Destination.id == dest.id).one()
    assert bool(route2.enabled) == r_enabled
    assert dict(src2.config_json or {}) == src_cfg
    assert dest2.name == dest_name
