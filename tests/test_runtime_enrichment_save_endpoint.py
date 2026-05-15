"""Runtime Enrichment draft save API — enrichments row upsert per stream."""

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
from app.mappings.models import Mapping
from app.enrichments.models import Enrichment
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream

from tests.test_runtime_logs_page_endpoint import _log as _delivery_log
from tests.test_runtime_logs_page_endpoint import _seed_stream_two_routes


@pytest.fixture
def enrichment_save_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_enrichment_save_creates_new_row(enrichment_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.commit()

    assert db_session.query(Enrichment).filter(Enrichment.stream_id == sid).count() == 0

    r = enrichment_save_client.post(
        f"/api/v1/runtime/enrichments/stream/{sid}/save",
        json={
            "enrichment": {"vendor": "Acme", "product": "EDR"},
            "override_policy": "fill_missing",
            "enabled": True,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["stream_id"] == sid
    assert body["field_count"] == 2
    assert body["override_policy"] == "fill_missing"
    assert body["enabled"] is True
    assert body["enrichment_id"] > 0
    assert "created" in body["message"].lower()

    db_session.expire_all()
    row = db_session.query(Enrichment).filter(Enrichment.stream_id == sid).one()
    assert row.enrichment_json == {"vendor": "Acme", "product": "EDR"}
    assert row.override_policy == "KEEP_EXISTING"
    assert row.enabled is True


def test_enrichment_save_updates_existing(enrichment_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.add(
        Enrichment(
            stream_id=sid,
            enrichment_json={"old": "x"},
            override_policy="KEEP_EXISTING",
            enabled=True,
        )
    )
    db_session.commit()
    eid = db_session.query(Enrichment).filter(Enrichment.stream_id == sid).one().id

    r = enrichment_save_client.post(
        f"/api/v1/runtime/enrichments/stream/{sid}/save",
        json={
            "enrichment": {"vendor": "X"},
            "override_policy": "override",
            "enabled": False,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["enrichment_id"] == eid
    assert body["field_count"] == 1
    assert body["override_policy"] == "override"
    assert body["enabled"] is False
    assert "updated" in body["message"].lower()

    db_session.expire_all()
    row = db_session.query(Enrichment).filter(Enrichment.stream_id == sid).one()
    assert row.enrichment_json == {"vendor": "X"}
    assert row.override_policy == "OVERRIDE"
    assert row.enabled is False


def test_enrichment_save_empty_enrichment_returns_422(enrichment_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.commit()

    r = enrichment_save_client.post(
        f"/api/v1/runtime/enrichments/stream/{sid}/save",
        json={"enrichment": {}, "override_policy": "fill_missing"},
    )
    assert r.status_code == 422


def test_enrichment_save_invalid_override_policy_returns_422(
    enrichment_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.commit()

    r = enrichment_save_client.post(
        f"/api/v1/runtime/enrichments/stream/{sid}/save",
        json={"enrichment": {"a": 1}, "override_policy": "KEEP_EXISTING"},
    )
    assert r.status_code == 422


def test_enrichment_save_stream_not_found(enrichment_save_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    db_session.commit()

    r = enrichment_save_client.post(
        "/api/v1/runtime/enrichments/stream/999999999/save",
        json={"enrichment": {"k": "v"}},
    )
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "STREAM_NOT_FOUND"


def test_enrichment_save_single_commit(
    monkeypatch: pytest.MonkeyPatch,
    enrichment_save_client: TestClient,
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
        enrichment_save_client.post(
            f"/api/v1/runtime/enrichments/stream/{sid}/save",
            json={"enrichment": {"x": 1}},
        ).status_code
        == 200
    )
    assert commits["n"] == 1


def test_enrichment_save_mapping_unchanged(enrichment_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.add(
        Mapping(
            stream_id=sid,
            event_array_path="$.items",
            field_mappings_json={"id": "$.id"},
        )
    )
    db_session.commit()
    m = db_session.query(Mapping).filter(Mapping.stream_id == sid).one()
    before_path = m.event_array_path
    before_fm = dict(m.field_mappings_json or {})

    assert (
        enrichment_save_client.post(
            f"/api/v1/runtime/enrichments/stream/{sid}/save",
            json={"enrichment": {"vendor": "Z"}},
        ).status_code
        == 200
    )

    db_session.expire_all()
    m2 = db_session.query(Mapping).filter(Mapping.stream_id == sid).one()
    assert m2.event_array_path == before_path
    assert dict(m2.field_mappings_json or {}) == before_fm


def test_enrichment_save_checkpoint_unchanged(enrichment_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    cp = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()
    before_type = cp.checkpoint_type
    before_val = dict(cp.checkpoint_value_json or {})
    db_session.commit()

    assert (
        enrichment_save_client.post(
            f"/api/v1/runtime/enrichments/stream/{sid}/save",
            json={"enrichment": {"a": 1}},
        ).status_code
        == 200
    )

    db_session.expire_all()
    cp2 = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()
    assert cp2.checkpoint_type == before_type
    assert dict(cp2.checkpoint_value_json or {}) == before_val


def test_enrichment_save_delivery_logs_unchanged(enrichment_save_client: TestClient, db_session: Session) -> None:
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

    assert (
        enrichment_save_client.post(
            f"/api/v1/runtime/enrichments/stream/{sid}/save",
            json={"enrichment": {"k": "v"}},
        ).status_code
        == 200
    )

    assert db_session.query(DeliveryLog).count() == before


def test_enrichment_save_stream_source_route_destination_unchanged(
    enrichment_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    src = db_session.query(Source).filter(Source.id == stream.source_id).one()
    route = db_session.query(Route).filter(Route.stream_id == sid).first()
    dest = db_session.query(Destination).filter(Destination.id == route.destination_id).one()

    s_enabled = bool(stream.enabled)
    s_status = stream.status
    s_cfg = dict(stream.config_json or {})
    src_cfg = dict(src.config_json or {})
    r_enabled = bool(route.enabled)
    dest_name = dest.name
    db_session.commit()

    assert (
        enrichment_save_client.post(
            f"/api/v1/runtime/enrichments/stream/{sid}/save",
            json={"enrichment": {"x": 1}},
        ).status_code
        == 200
    )

    db_session.expire_all()
    stream2 = db_session.query(Stream).filter(Stream.id == sid).one()
    src2 = db_session.query(Source).filter(Source.id == src.id).one()
    route2 = db_session.query(Route).filter(Route.id == route.id).one()
    dest2 = db_session.query(Destination).filter(Destination.id == dest.id).one()

    assert bool(stream2.enabled) == s_enabled
    assert stream2.status == s_status
    assert dict(stream2.config_json or {}) == s_cfg
    assert dict(src2.config_json or {}) == src_cfg
    assert bool(route2.enabled) == r_enabled
    assert dest2.name == dest_name
