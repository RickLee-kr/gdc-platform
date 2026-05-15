"""Runtime Route failure policy save API — route failure_policy update."""

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
def route_failure_policy_save_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_route_failure_policy_saved(
    route_failure_policy_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    db_session.commit()

    payload = {"failure_policy": "RETRY_AND_BACKOFF"}
    r = route_failure_policy_save_client.post(
        f"/api/v1/runtime/routes/{rid}/failure-policy/save",
        json=payload,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["route_id"] == rid
    assert body["stream_id"] == h["stream_id"]
    assert body["destination_id"] == h["dest_a_id"]
    assert body["failure_policy"] == "RETRY_AND_BACKOFF"
    assert body["message"] == "Route failure policy saved successfully"

    db_session.expire_all()
    route = db_session.query(Route).filter(Route.id == rid).one()
    assert route.failure_policy == "RETRY_AND_BACKOFF"


@pytest.mark.parametrize(
    "policy",
    [
        "LOG_AND_CONTINUE",
        "PAUSE_STREAM_ON_FAILURE",
        "RETRY_AND_BACKOFF",
        "DISABLE_ROUTE_ON_FAILURE",
    ],
)
def test_route_failure_policy_allowed_values(
    policy: str,
    route_failure_policy_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    db_session.commit()

    r = route_failure_policy_save_client.post(
        f"/api/v1/runtime/routes/{rid}/failure-policy/save",
        json={"failure_policy": policy},
    )
    assert r.status_code == 200
    assert r.json()["failure_policy"] == policy


def test_route_failure_policy_overwrite(
    route_failure_policy_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    route = db_session.query(Route).filter(Route.id == rid).one()
    route.failure_policy = "LOG_AND_CONTINUE"
    db_session.commit()

    r = route_failure_policy_save_client.post(
        f"/api/v1/runtime/routes/{rid}/failure-policy/save",
        json={"failure_policy": "DISABLE_ROUTE_ON_FAILURE"},
    )
    assert r.status_code == 200

    db_session.expire_all()
    route2 = db_session.query(Route).filter(Route.id == rid).one()
    assert route2.failure_policy == "DISABLE_ROUTE_ON_FAILURE"


def test_route_failure_policy_route_not_found(
    route_failure_policy_save_client: TestClient,
    db_session: Session,
) -> None:
    _seed_stream_two_routes(db_session)
    db_session.commit()

    r = route_failure_policy_save_client.post(
        "/api/v1/runtime/routes/999999999/failure-policy/save",
        json={"failure_policy": "RETRY_AND_BACKOFF"},
    )
    assert r.status_code == 404
    detail = r.json()["detail"]
    assert detail["error_code"] == "ROUTE_NOT_FOUND"


def test_route_failure_policy_invalid_value_returns_422(
    route_failure_policy_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    db_session.commit()

    r = route_failure_policy_save_client.post(
        f"/api/v1/runtime/routes/{rid}/failure-policy/save",
        json={"failure_policy": "INVALID_POLICY"},
    )
    assert r.status_code == 422


def test_route_failure_policy_missing_field_returns_422(
    route_failure_policy_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    db_session.commit()

    r = route_failure_policy_save_client.post(
        f"/api/v1/runtime/routes/{rid}/failure-policy/save",
        json={},
    )
    assert r.status_code == 422


def test_route_failure_policy_formatter_config_unchanged(
    route_failure_policy_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    route = db_session.query(Route).filter(Route.id == rid).one()
    route.formatter_config_json = {"message_format": "json", "tag": "keep"}
    before = dict(route.formatter_config_json or {})
    db_session.commit()

    assert (
        route_failure_policy_save_client.post(
            f"/api/v1/runtime/routes/{rid}/failure-policy/save",
            json={"failure_policy": "PAUSE_STREAM_ON_FAILURE"},
        ).status_code
        == 200
    )

    db_session.expire_all()
    route2 = db_session.query(Route).filter(Route.id == rid).one()
    assert dict(route2.formatter_config_json or {}) == before


def test_route_failure_policy_rate_limit_unchanged(
    route_failure_policy_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    route = db_session.query(Route).filter(Route.id == rid).one()
    route.rate_limit_json = {"max_events": 77, "per_seconds": 2}
    before = dict(route.rate_limit_json or {})
    db_session.commit()

    assert (
        route_failure_policy_save_client.post(
            f"/api/v1/runtime/routes/{rid}/failure-policy/save",
            json={"failure_policy": "PAUSE_STREAM_ON_FAILURE"},
        ).status_code
        == 200
    )

    db_session.expire_all()
    route2 = db_session.query(Route).filter(Route.id == rid).one()
    assert dict(route2.rate_limit_json or {}) == before


def test_route_failure_policy_other_entities_unchanged(
    route_failure_policy_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    rid = h["route_a_id"]
    did = h["dest_a_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    source = db_session.query(Source).filter(Source.id == stream.source_id).one()
    destination = db_session.query(Destination).filter(Destination.id == did).one()
    checkpoint = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()
    _delivery_log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=sid,
        route_id=rid,
        destination_id=did,
        stage="run_complete",
    )
    before = {
        "stream_enabled": bool(stream.enabled),
        "stream_status": stream.status,
        "stream_config": dict(stream.config_json or {}),
        "source_config": dict(source.config_json or {}),
        "dest_name": destination.name,
        "dest_config": dict(destination.config_json or {}),
        "dest_rate_limit": dict(destination.rate_limit_json or {}),
        "checkpoint_type": checkpoint.checkpoint_type,
        "checkpoint_value": dict(checkpoint.checkpoint_value_json or {}),
        "delivery_logs_count": db_session.query(DeliveryLog).count(),
    }
    db_session.commit()

    assert (
        route_failure_policy_save_client.post(
            f"/api/v1/runtime/routes/{rid}/failure-policy/save",
            json={"failure_policy": "DISABLE_ROUTE_ON_FAILURE"},
        ).status_code
        == 200
    )

    db_session.expire_all()
    stream2 = db_session.query(Stream).filter(Stream.id == sid).one()
    source2 = db_session.query(Source).filter(Source.id == source.id).one()
    destination2 = db_session.query(Destination).filter(Destination.id == did).one()
    checkpoint2 = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()
    assert bool(stream2.enabled) == before["stream_enabled"]
    assert stream2.status == before["stream_status"]
    assert dict(stream2.config_json or {}) == before["stream_config"]
    assert dict(source2.config_json or {}) == before["source_config"]
    assert destination2.name == before["dest_name"]
    assert dict(destination2.config_json or {}) == before["dest_config"]
    assert dict(destination2.rate_limit_json or {}) == before["dest_rate_limit"]
    assert checkpoint2.checkpoint_type == before["checkpoint_type"]
    assert dict(checkpoint2.checkpoint_value_json or {}) == before["checkpoint_value"]
    assert db_session.query(DeliveryLog).count() == before["delivery_logs_count"]


def test_existing_route_rate_limit_api_regression(
    route_failure_policy_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    db_session.commit()

    assert (
        route_failure_policy_save_client.post(
            f"/api/v1/runtime/routes/{rid}/failure-policy/save",
            json={"failure_policy": "RETRY_AND_BACKOFF"},
        ).status_code
        == 200
    )

    payload = {"rate_limit": {"max_events": 1000, "per_seconds": 30}}
    r = route_failure_policy_save_client.post(f"/api/v1/runtime/routes/{rid}/rate-limit/save", json=payload)
    assert r.status_code == 200
    assert r.json()["rate_limit"] == payload["rate_limit"]


def test_existing_destination_rate_limit_api_regression(
    route_failure_policy_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    did = h["dest_a_id"]
    db_session.commit()

    assert (
        route_failure_policy_save_client.post(
            f"/api/v1/runtime/routes/{rid}/failure-policy/save",
            json={"failure_policy": "RETRY_AND_BACKOFF"},
        ).status_code
        == 200
    )

    payload = {"rate_limit": {"max_events": 100, "per_seconds": 1}}
    r = route_failure_policy_save_client.post(f"/api/v1/runtime/destinations/{did}/rate-limit/save", json=payload)
    assert r.status_code == 200
    assert r.json()["rate_limit"] == payload["rate_limit"]


def test_existing_stream_rate_limit_api_regression(
    route_failure_policy_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    sid = h["stream_id"]
    db_session.commit()

    assert (
        route_failure_policy_save_client.post(
            f"/api/v1/runtime/routes/{rid}/failure-policy/save",
            json={"failure_policy": "RETRY_AND_BACKOFF"},
        ).status_code
        == 200
    )

    payload = {"rate_limit": {"max_requests": 30, "per_seconds": 60}}
    r = route_failure_policy_save_client.post(f"/api/v1/runtime/streams/{sid}/rate-limit/save", json=payload)
    assert r.status_code == 200
    assert r.json()["rate_limit"] == payload["rate_limit"]


def test_route_failure_policy_single_commit(
    monkeypatch: pytest.MonkeyPatch,
    route_failure_policy_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    db_session.commit()

    commits = {"n": 0}
    real_commit = Session.commit

    def _count_commit(self: Session, *args: Any, **kwargs: Any) -> None:
        commits["n"] += 1
        return real_commit(self, *args, **kwargs)

    monkeypatch.setattr(Session, "commit", _count_commit)

    assert (
        route_failure_policy_save_client.post(
            f"/api/v1/runtime/routes/{rid}/failure-policy/save",
            json={"failure_policy": "RETRY_AND_BACKOFF"},
        ).status_code
        == 200
    )
    assert commits["n"] == 1
