"""Runtime Route formatter config save API — route formatter_config_json update."""

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
def route_formatter_save_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_route_formatter_config_saved(route_formatter_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    db_session.commit()

    payload = {
        "formatter_config": {
            "app_name": "my-app",
            "tag": "gdc",
            "facility": 16,
            "severity": 6,
            "message_format": "json",
        }
    }
    r = route_formatter_save_client.post(f"/api/v1/runtime/routes/{rid}/formatter/save", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["route_id"] == rid
    assert body["stream_id"] == h["stream_id"]
    assert body["destination_id"] == h["dest_a_id"]
    assert body["formatter_config"] == payload["formatter_config"]
    assert body["field_count"] == 5

    db_session.expire_all()
    route = db_session.query(Route).filter(Route.id == rid).one()
    assert dict(route.formatter_config_json or {}) == payload["formatter_config"]


def test_route_formatter_config_update(route_formatter_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    route = db_session.query(Route).filter(Route.id == rid).one()
    route.formatter_config_json = {"message_format": "plain"}
    db_session.commit()

    payload = {"formatter_config": {"message_format": "json", "tag": "new-tag"}}
    r = route_formatter_save_client.post(f"/api/v1/runtime/routes/{rid}/formatter/save", json=payload)
    assert r.status_code == 200
    assert r.json()["field_count"] == 2

    db_session.expire_all()
    route2 = db_session.query(Route).filter(Route.id == rid).one()
    assert dict(route2.formatter_config_json or {}) == payload["formatter_config"]


def test_route_formatter_config_empty_returns_422(
    route_formatter_save_client: TestClient, db_session: Session
) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    db_session.commit()

    r = route_formatter_save_client.post(
        f"/api/v1/runtime/routes/{rid}/formatter/save",
        json={"formatter_config": {}},
    )
    assert r.status_code == 422


def test_route_formatter_route_not_found(route_formatter_save_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    db_session.commit()

    r = route_formatter_save_client.post(
        "/api/v1/runtime/routes/999999999/formatter/save",
        json={"formatter_config": {"tag": "x"}},
    )
    assert r.status_code == 404
    detail = r.json()["detail"]
    assert detail["error_code"] == "ROUTE_NOT_FOUND"


def test_route_formatter_single_commit(
    monkeypatch: pytest.MonkeyPatch,
    route_formatter_save_client: TestClient,
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
        route_formatter_save_client.post(
            f"/api/v1/runtime/routes/{rid}/formatter/save",
            json={"formatter_config": {"message_format": "json"}},
        ).status_code
        == 200
    )
    assert commits["n"] == 1


def test_route_formatter_stream_unchanged(route_formatter_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    rid = h["route_a_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    before = {
        "enabled": bool(stream.enabled),
        "status": stream.status,
        "config_json": dict(stream.config_json or {}),
    }
    db_session.commit()

    assert (
        route_formatter_save_client.post(
            f"/api/v1/runtime/routes/{rid}/formatter/save",
            json={"formatter_config": {"tag": "stream-unchanged"}},
        ).status_code
        == 200
    )

    db_session.expire_all()
    stream2 = db_session.query(Stream).filter(Stream.id == sid).one()
    assert bool(stream2.enabled) == before["enabled"]
    assert stream2.status == before["status"]
    assert dict(stream2.config_json or {}) == before["config_json"]


def test_route_formatter_source_unchanged(route_formatter_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    rid = h["route_a_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    src = db_session.query(Source).filter(Source.id == stream.source_id).one()
    before_cfg = dict(src.config_json or {})
    db_session.commit()

    assert (
        route_formatter_save_client.post(
            f"/api/v1/runtime/routes/{rid}/formatter/save",
            json={"formatter_config": {"tag": "source-unchanged"}},
        ).status_code
        == 200
    )

    db_session.expire_all()
    src2 = db_session.query(Source).filter(Source.id == src.id).one()
    assert dict(src2.config_json or {}) == before_cfg


def test_route_formatter_destination_unchanged(
    route_formatter_save_client: TestClient, db_session: Session
) -> None:
    h = _seed_stream_two_routes(db_session)
    rid = h["route_a_id"]
    route = db_session.query(Route).filter(Route.id == rid).one()
    dest = db_session.query(Destination).filter(Destination.id == route.destination_id).one()
    before_name = dest.name
    before_cfg = dict(dest.config_json or {})
    db_session.commit()

    assert (
        route_formatter_save_client.post(
            f"/api/v1/runtime/routes/{rid}/formatter/save",
            json={"formatter_config": {"tag": "destination-unchanged"}},
        ).status_code
        == 200
    )

    db_session.expire_all()
    dest2 = db_session.query(Destination).filter(Destination.id == dest.id).one()
    assert dest2.name == before_name
    assert dict(dest2.config_json or {}) == before_cfg


def test_route_formatter_mapping_unchanged(route_formatter_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    rid = h["route_a_id"]
    db_session.add(
        Mapping(
            stream_id=sid,
            event_array_path="$.items",
            field_mappings_json={"id": "$.id"},
        )
    )
    db_session.commit()
    mapping = db_session.query(Mapping).filter(Mapping.stream_id == sid).one()
    before_path = mapping.event_array_path
    before_fields = dict(mapping.field_mappings_json or {})

    assert (
        route_formatter_save_client.post(
            f"/api/v1/runtime/routes/{rid}/formatter/save",
            json={"formatter_config": {"tag": "mapping-unchanged"}},
        ).status_code
        == 200
    )

    db_session.expire_all()
    mapping2 = db_session.query(Mapping).filter(Mapping.stream_id == sid).one()
    assert mapping2.event_array_path == before_path
    assert dict(mapping2.field_mappings_json or {}) == before_fields


def test_route_formatter_enrichment_unchanged(
    route_formatter_save_client: TestClient, db_session: Session
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    rid = h["route_a_id"]
    db_session.add(
        Enrichment(
            stream_id=sid,
            enrichment_json={"vendor": "Acme"},
            override_policy="KEEP_EXISTING",
            enabled=True,
        )
    )
    db_session.commit()
    enrichment = db_session.query(Enrichment).filter(Enrichment.stream_id == sid).one()
    before_json = dict(enrichment.enrichment_json or {})
    before_policy = enrichment.override_policy
    before_enabled = bool(enrichment.enabled)

    assert (
        route_formatter_save_client.post(
            f"/api/v1/runtime/routes/{rid}/formatter/save",
            json={"formatter_config": {"tag": "enrichment-unchanged"}},
        ).status_code
        == 200
    )

    db_session.expire_all()
    enrichment2 = db_session.query(Enrichment).filter(Enrichment.stream_id == sid).one()
    assert dict(enrichment2.enrichment_json or {}) == before_json
    assert enrichment2.override_policy == before_policy
    assert bool(enrichment2.enabled) == before_enabled


def test_route_formatter_checkpoint_unchanged(
    route_formatter_save_client: TestClient, db_session: Session
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    rid = h["route_a_id"]
    checkpoint = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()
    before_type = checkpoint.checkpoint_type
    before_value = dict(checkpoint.checkpoint_value_json or {})
    db_session.commit()

    assert (
        route_formatter_save_client.post(
            f"/api/v1/runtime/routes/{rid}/formatter/save",
            json={"formatter_config": {"tag": "checkpoint-unchanged"}},
        ).status_code
        == 200
    )

    db_session.expire_all()
    checkpoint2 = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()
    assert checkpoint2.checkpoint_type == before_type
    assert dict(checkpoint2.checkpoint_value_json or {}) == before_value


def test_route_formatter_delivery_logs_unchanged(
    route_formatter_save_client: TestClient, db_session: Session
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    rid = h["route_a_id"]
    _delivery_log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=sid,
        route_id=rid,
        destination_id=h["dest_a_id"],
        stage="run_complete",
    )
    db_session.commit()
    before = db_session.query(DeliveryLog).count()

    assert (
        route_formatter_save_client.post(
            f"/api/v1/runtime/routes/{rid}/formatter/save",
            json={"formatter_config": {"tag": "logs-unchanged"}},
        ).status_code
        == 200
    )

    assert db_session.query(DeliveryLog).count() == before
