"""Runtime Destination rate-limit config save API — destination rate_limit_json update."""

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
def destination_rate_limit_save_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_destination_rate_limit_saved(
    destination_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    did = h["dest_a_id"]
    db_session.commit()

    payload = {
        "rate_limit": {
            "max_events": 100,
            "per_seconds": 1,
            "batch_size": 50,
        },
    }
    r = destination_rate_limit_save_client.post(
        f"/api/v1/runtime/destinations/{did}/rate-limit/save",
        json=payload,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["destination_id"] == did
    assert body["destination_type"] == "WEBHOOK_POST"
    assert body["rate_limit"] == payload["rate_limit"]
    assert body["field_count"] == 3
    assert body["message"] == "Destination rate limit saved successfully"

    db_session.expire_all()
    dest = db_session.query(Destination).filter(Destination.id == did).one()
    assert dict(dest.rate_limit_json or {}) == payload["rate_limit"]


def test_destination_rate_limit_overwrite(
    destination_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    did = h["dest_a_id"]
    dest = db_session.query(Destination).filter(Destination.id == did).one()
    dest.rate_limit_json = {"max_events": 10}
    db_session.commit()

    payload = {"rate_limit": {"max_events": 500, "per_seconds": 10}}
    r = destination_rate_limit_save_client.post(
        f"/api/v1/runtime/destinations/{did}/rate-limit/save",
        json=payload,
    )
    assert r.status_code == 200
    assert r.json()["field_count"] == 2

    db_session.expire_all()
    dest2 = db_session.query(Destination).filter(Destination.id == did).one()
    assert dict(dest2.rate_limit_json or {}) == payload["rate_limit"]


def test_destination_rate_limit_nested_dict(
    destination_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    did = h["dest_a_id"]
    db_session.commit()

    payload = {"rate_limit": {"tier": {"burst": 100, "steady": 50}, "global_cap": 1000}}
    r = destination_rate_limit_save_client.post(
        f"/api/v1/runtime/destinations/{did}/rate-limit/save",
        json=payload,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["rate_limit"] == payload["rate_limit"]
    assert body["field_count"] == 2


def test_destination_rate_limit_mixed_scalar_types(
    destination_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    did = h["dest_a_id"]
    db_session.commit()

    payload = {
        "rate_limit": {
            "enabled": True,
            "max_events": 42,
            "note": "mixed",
        },
    }
    r = destination_rate_limit_save_client.post(
        f"/api/v1/runtime/destinations/{did}/rate-limit/save",
        json=payload,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["rate_limit"] == payload["rate_limit"]
    assert body["field_count"] == 3


def test_destination_rate_limit_field_count_top_level_keys(
    destination_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    did = h["dest_a_id"]
    db_session.commit()

    payload = {"rate_limit": {"a": 1, "b": 2, "c": 3, "d": 4}}
    r = destination_rate_limit_save_client.post(
        f"/api/v1/runtime/destinations/{did}/rate-limit/save",
        json=payload,
    )
    assert r.status_code == 200
    assert r.json()["field_count"] == 4


def test_destination_rate_limit_destination_not_found(
    destination_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    _seed_stream_two_routes(db_session)
    db_session.commit()

    r = destination_rate_limit_save_client.post(
        "/api/v1/runtime/destinations/999999999/rate-limit/save",
        json={"rate_limit": {"max_events": 1}},
    )
    assert r.status_code == 404
    detail = r.json()["detail"]
    assert detail["error_code"] == "DESTINATION_NOT_FOUND"


def test_destination_rate_limit_empty_returns_422(
    destination_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    did = h["dest_a_id"]
    db_session.commit()

    r = destination_rate_limit_save_client.post(
        f"/api/v1/runtime/destinations/{did}/rate-limit/save",
        json={"rate_limit": {}},
    )
    assert r.status_code == 422


def test_destination_rate_limit_missing_returns_422(
    destination_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    did = h["dest_a_id"]
    db_session.commit()

    r = destination_rate_limit_save_client.post(
        f"/api/v1/runtime/destinations/{did}/rate-limit/save",
        json={},
    )
    assert r.status_code == 422


def test_destination_rate_limit_list_returns_422(
    destination_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    did = h["dest_a_id"]
    db_session.commit()

    r = destination_rate_limit_save_client.post(
        f"/api/v1/runtime/destinations/{did}/rate-limit/save",
        json={"rate_limit": [1, 2, 3]},
    )
    assert r.status_code == 422


def test_destination_rate_limit_string_returns_422(
    destination_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    did = h["dest_a_id"]
    db_session.commit()

    r = destination_rate_limit_save_client.post(
        f"/api/v1/runtime/destinations/{did}/rate-limit/save",
        json={"rate_limit": "not-a-dict"},
    )
    assert r.status_code == 422


def test_destination_rate_limit_stream_source_route_core_unchanged(
    destination_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    rid = h["route_a_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    src = db_session.query(Source).filter(Source.id == stream.source_id).one()
    route = db_session.query(Route).filter(Route.id == rid).one()
    before_stream = {
        "enabled": bool(stream.enabled),
        "status": stream.status,
        "config_json": dict(stream.config_json or {}),
    }
    before_src_cfg = dict(src.config_json or {})
    before_route = {
        "enabled": bool(route.enabled),
        "failure_policy": route.failure_policy,
        "status": route.status,
        "stream_id": int(route.stream_id),
        "destination_id": int(route.destination_id),
    }
    db_session.commit()

    assert (
        destination_rate_limit_save_client.post(
            f"/api/v1/runtime/destinations/{h['dest_a_id']}/rate-limit/save",
            json={"rate_limit": {"max_events": 99}},
        ).status_code
        == 200
    )

    db_session.expire_all()
    stream2 = db_session.query(Stream).filter(Stream.id == sid).one()
    src2 = db_session.query(Source).filter(Source.id == src.id).one()
    route2 = db_session.query(Route).filter(Route.id == rid).one()
    assert bool(stream2.enabled) == before_stream["enabled"]
    assert stream2.status == before_stream["status"]
    assert dict(stream2.config_json or {}) == before_stream["config_json"]
    assert dict(src2.config_json or {}) == before_src_cfg
    assert bool(route2.enabled) == before_route["enabled"]
    assert route2.failure_policy == before_route["failure_policy"]
    assert route2.status == before_route["status"]
    assert int(route2.stream_id) == before_route["stream_id"]
    assert int(route2.destination_id) == before_route["destination_id"]


def test_destination_rate_limit_route_rate_limit_json_unchanged(
    destination_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    route = db_session.query(Route).filter(Route.id == rid).one()
    route.rate_limit_json = {"max_events": 77, "per_seconds": 2}
    before_rl = dict(route.rate_limit_json or {})
    db_session.commit()

    assert (
        destination_rate_limit_save_client.post(
            f"/api/v1/runtime/destinations/{h['dest_a_id']}/rate-limit/save",
            json={"rate_limit": {"max_events": 100}},
        ).status_code
        == 200
    )

    db_session.expire_all()
    route2 = db_session.query(Route).filter(Route.id == rid).one()
    assert dict(route2.rate_limit_json or {}) == before_rl


def test_destination_rate_limit_route_formatter_config_unchanged(
    destination_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    route = db_session.query(Route).filter(Route.id == rid).one()
    route.formatter_config_json = {"message_format": "json", "tag": "keep"}
    before_fmt = dict(route.formatter_config_json or {})
    db_session.commit()

    assert (
        destination_rate_limit_save_client.post(
            f"/api/v1/runtime/destinations/{h['dest_a_id']}/rate-limit/save",
            json={"rate_limit": {"max_events": 100}},
        ).status_code
        == 200
    )

    db_session.expire_all()
    route2 = db_session.query(Route).filter(Route.id == rid).one()
    assert dict(route2.formatter_config_json or {}) == before_fmt


def test_destination_rate_limit_checkpoint_delivery_logs_unchanged(
    destination_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    rid = h["route_a_id"]
    checkpoint = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()
    before_type = checkpoint.checkpoint_type
    before_value = dict(checkpoint.checkpoint_value_json or {})
    _delivery_log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=sid,
        route_id=rid,
        destination_id=h["dest_a_id"],
        stage="run_complete",
    )
    db_session.commit()
    before_logs = db_session.query(DeliveryLog).count()

    assert (
        destination_rate_limit_save_client.post(
            f"/api/v1/runtime/destinations/{h['dest_a_id']}/rate-limit/save",
            json={"rate_limit": {"max_events": 20}},
        ).status_code
        == 200
    )

    db_session.expire_all()
    checkpoint2 = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()
    assert checkpoint2.checkpoint_type == before_type
    assert dict(checkpoint2.checkpoint_value_json or {}) == before_value
    assert db_session.query(DeliveryLog).count() == before_logs


def test_existing_route_rate_limit_save_api_still_works(
    destination_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    db_session.commit()

    assert (
        destination_rate_limit_save_client.post(
            f"/api/v1/runtime/destinations/{h['dest_a_id']}/rate-limit/save",
            json={"rate_limit": {"max_events": 1}},
        ).status_code
        == 200
    )

    payload = {"rate_limit": {"max_events": 1000, "per_seconds": 30}}
    r = destination_rate_limit_save_client.post(f"/api/v1/runtime/routes/{rid}/rate-limit/save", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["route_id"] == rid
    assert body["rate_limit"] == payload["rate_limit"]

    db_session.expire_all()
    route = db_session.query(Route).filter(Route.id == rid).one()
    assert dict(route.rate_limit_json or {}) == payload["rate_limit"]


def test_existing_stream_rate_limit_save_api_still_works(
    destination_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.commit()

    assert (
        destination_rate_limit_save_client.post(
            f"/api/v1/runtime/destinations/{h['dest_a_id']}/rate-limit/save",
            json={"rate_limit": {"max_events": 1}},
        ).status_code
        == 200
    )

    payload = {"rate_limit": {"max_requests": 30, "per_seconds": 60}}
    r = destination_rate_limit_save_client.post(f"/api/v1/runtime/streams/{sid}/rate-limit/save", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["stream_id"] == sid
    assert body["rate_limit"] == payload["rate_limit"]

    db_session.expire_all()
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    assert dict(stream.rate_limit_json or {}) == payload["rate_limit"]


def test_destination_rate_limit_single_commit(
    monkeypatch: pytest.MonkeyPatch,
    destination_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    did = h["dest_a_id"]
    db_session.commit()

    commits = {"n": 0}
    real_commit = Session.commit

    def _count_commit(self: Session, *args: Any, **kwargs: Any) -> None:
        commits["n"] += 1
        return real_commit(self, *args, **kwargs)

    monkeypatch.setattr(Session, "commit", _count_commit)

    assert (
        destination_rate_limit_save_client.post(
            f"/api/v1/runtime/destinations/{did}/rate-limit/save",
            json={"rate_limit": {"max_events": 10}},
        ).status_code
        == 200
    )
    assert commits["n"] == 1
