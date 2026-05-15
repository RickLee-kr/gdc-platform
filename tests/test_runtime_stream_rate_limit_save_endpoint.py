"""Runtime Stream source rate-limit config save API — stream rate_limit_json update."""

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
from app.streams.models import Stream

from tests.test_runtime_logs_page_endpoint import _log as _delivery_log
from tests.test_runtime_logs_page_endpoint import _seed_stream_two_routes


@pytest.fixture
def stream_rate_limit_save_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_stream_rate_limit_saved(stream_rate_limit_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.commit()

    payload = {
        "rate_limit": {
            "max_requests": 60,
            "per_seconds": 60,
            "respect_retry_after": True,
        },
    }
    r = stream_rate_limit_save_client.post(f"/api/v1/runtime/streams/{sid}/rate-limit/save", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["stream_id"] == sid
    assert body["connector_id"] == h["connector_id"]
    stream_row = db_session.query(Stream).filter(Stream.id == sid).one()
    assert body["source_id"] == stream_row.source_id
    assert body["rate_limit"] == payload["rate_limit"]
    assert body["field_count"] == 3
    assert body["message"] == "Stream source rate limit saved successfully"

    db_session.expire_all()
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    assert dict(stream.rate_limit_json or {}) == payload["rate_limit"]


def test_stream_rate_limit_overwrite(stream_rate_limit_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    stream.rate_limit_json = {"max_requests": 10}
    db_session.commit()

    payload = {"rate_limit": {"max_requests": 500, "per_seconds": 10}}
    r = stream_rate_limit_save_client.post(f"/api/v1/runtime/streams/{sid}/rate-limit/save", json=payload)
    assert r.status_code == 200
    assert r.json()["field_count"] == 2

    db_session.expire_all()
    stream2 = db_session.query(Stream).filter(Stream.id == sid).one()
    assert dict(stream2.rate_limit_json or {}) == payload["rate_limit"]


def test_stream_rate_limit_nested_dict(stream_rate_limit_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.commit()

    payload = {"rate_limit": {"tier": {"burst": 100, "steady": 50}, "global_cap": 1000}}
    r = stream_rate_limit_save_client.post(f"/api/v1/runtime/streams/{sid}/rate-limit/save", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["rate_limit"] == payload["rate_limit"]
    assert body["field_count"] == 2

    db_session.expire_all()
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    assert dict(stream.rate_limit_json or {}) == payload["rate_limit"]


def test_stream_rate_limit_mixed_scalar_types(
    stream_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.commit()

    payload = {
        "rate_limit": {
            "enabled": True,
            "max_requests": 42,
            "note": "mixed",
        },
    }
    r = stream_rate_limit_save_client.post(f"/api/v1/runtime/streams/{sid}/rate-limit/save", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["rate_limit"] == payload["rate_limit"]
    assert body["field_count"] == 3


def test_stream_rate_limit_field_count_top_level_keys(
    stream_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.commit()

    payload = {"rate_limit": {"a": 1, "b": 2, "c": 3, "d": 4}}
    r = stream_rate_limit_save_client.post(f"/api/v1/runtime/streams/{sid}/rate-limit/save", json=payload)
    assert r.status_code == 200
    assert r.json()["field_count"] == 4


def test_stream_rate_limit_stream_not_found(
    stream_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    _seed_stream_two_routes(db_session)
    db_session.commit()

    r = stream_rate_limit_save_client.post(
        "/api/v1/runtime/streams/999999999/rate-limit/save",
        json={"rate_limit": {"max_requests": 1}},
    )
    assert r.status_code == 404
    detail = r.json()["detail"]
    assert detail["error_code"] == "STREAM_NOT_FOUND"


def test_stream_rate_limit_empty_returns_422(stream_rate_limit_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.commit()

    r = stream_rate_limit_save_client.post(
        f"/api/v1/runtime/streams/{sid}/rate-limit/save",
        json={"rate_limit": {}},
    )
    assert r.status_code == 422


def test_stream_rate_limit_missing_returns_422(
    stream_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.commit()

    r = stream_rate_limit_save_client.post(f"/api/v1/runtime/streams/{sid}/rate-limit/save", json={})
    assert r.status_code == 422


def test_stream_rate_limit_list_returns_422(stream_rate_limit_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.commit()

    r = stream_rate_limit_save_client.post(
        f"/api/v1/runtime/streams/{sid}/rate-limit/save",
        json={"rate_limit": [1, 2, 3]},
    )
    assert r.status_code == 422


def test_stream_rate_limit_string_returns_422(stream_rate_limit_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.commit()

    r = stream_rate_limit_save_client.post(
        f"/api/v1/runtime/streams/{sid}/rate-limit/save",
        json={"rate_limit": "not-a-dict"},
    )
    assert r.status_code == 422


def test_stream_rate_limit_mapping_enrichment_unchanged(
    stream_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.add(
        Mapping(
            stream_id=sid,
            event_array_path="$.items",
            field_mappings_json={"id": "$.id"},
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
    mapping = db_session.query(Mapping).filter(Mapping.stream_id == sid).one()
    enrichment = db_session.query(Enrichment).filter(Enrichment.stream_id == sid).one()
    before_map_path = mapping.event_array_path
    before_map_fields = dict(mapping.field_mappings_json or {})
    before_enr = dict(enrichment.enrichment_json or {})
    before_policy = enrichment.override_policy
    before_en_enabled = bool(enrichment.enabled)

    assert (
        stream_rate_limit_save_client.post(
            f"/api/v1/runtime/streams/{sid}/rate-limit/save",
            json={"rate_limit": {"max_requests": 99}},
        ).status_code
        == 200
    )

    db_session.expire_all()
    mapping2 = db_session.query(Mapping).filter(Mapping.stream_id == sid).one()
    enrichment2 = db_session.query(Enrichment).filter(Enrichment.stream_id == sid).one()
    assert mapping2.event_array_path == before_map_path
    assert dict(mapping2.field_mappings_json or {}) == before_map_fields
    assert dict(enrichment2.enrichment_json or {}) == before_enr
    assert enrichment2.override_policy == before_policy
    assert bool(enrichment2.enabled) == before_en_enabled


def test_stream_rate_limit_route_formatter_and_route_rate_limit_unchanged(
    stream_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    rid = h["route_a_id"]
    route = db_session.query(Route).filter(Route.id == rid).one()
    route.formatter_config_json = {"message_format": "json", "tag": "keep"}
    route.rate_limit_json = {"max_events": 77}
    before_fmt = dict(route.formatter_config_json or {})
    before_route_rl = dict(route.rate_limit_json or {})
    db_session.commit()

    assert (
        stream_rate_limit_save_client.post(
            f"/api/v1/runtime/streams/{sid}/rate-limit/save",
            json={"rate_limit": {"max_requests": 100}},
        ).status_code
        == 200
    )

    db_session.expire_all()
    route2 = db_session.query(Route).filter(Route.id == rid).one()
    assert dict(route2.formatter_config_json or {}) == before_fmt
    assert dict(route2.rate_limit_json or {}) == before_route_rl


def test_existing_route_rate_limit_save_api_still_works(
    stream_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    rid = h["route_a_id"]
    db_session.commit()

    assert (
        stream_rate_limit_save_client.post(
            f"/api/v1/runtime/streams/{sid}/rate-limit/save",
            json={"rate_limit": {"max_requests": 1}},
        ).status_code
        == 200
    )

    payload = {"rate_limit": {"max_events": 1000, "per_seconds": 30}}
    r = stream_rate_limit_save_client.post(f"/api/v1/runtime/routes/{rid}/rate-limit/save", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["route_id"] == rid
    assert body["rate_limit"] == payload["rate_limit"]

    db_session.expire_all()
    route = db_session.query(Route).filter(Route.id == rid).one()
    assert dict(route.rate_limit_json or {}) == payload["rate_limit"]


def test_stream_rate_limit_single_commit(
    monkeypatch: pytest.MonkeyPatch,
    stream_rate_limit_save_client: TestClient,
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

    assert (
        stream_rate_limit_save_client.post(
            f"/api/v1/runtime/streams/{sid}/rate-limit/save",
            json={"rate_limit": {"max_requests": 10}},
        ).status_code
        == 200
    )
    assert commits["n"] == 1


def test_stream_rate_limit_checkpoint_delivery_logs_unchanged(
    stream_rate_limit_save_client: TestClient,
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
        stream_rate_limit_save_client.post(
            f"/api/v1/runtime/streams/{sid}/rate-limit/save",
            json={"rate_limit": {"max_requests": 20}},
        ).status_code
        == 200
    )

    db_session.expire_all()
    checkpoint2 = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()
    assert checkpoint2.checkpoint_type == before_type
    assert dict(checkpoint2.checkpoint_value_json or {}) == before_value
    assert db_session.query(DeliveryLog).count() == before_logs


def test_stream_rate_limit_destination_unchanged(
    stream_rate_limit_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    dest = db_session.query(Destination).filter(Destination.id == h["dest_a_id"]).one()
    before_name = dest.name
    before_cfg = dict(dest.config_json or {})
    before_dest_rl = dict(dest.rate_limit_json or {})
    db_session.commit()

    assert (
        stream_rate_limit_save_client.post(
            f"/api/v1/runtime/streams/{sid}/rate-limit/save",
            json={"rate_limit": {"max_requests": 20}},
        ).status_code
        == 200
    )

    db_session.expire_all()
    dest2 = db_session.query(Destination).filter(Destination.id == dest.id).one()
    assert dest2.name == before_name
    assert dict(dest2.config_json or {}) == before_cfg
    assert dict(dest2.rate_limit_json or {}) == before_dest_rl
