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
def mapping_ui_save_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_mapping_ui_save_full_success(mapping_ui_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    r = mapping_ui_save_client.post(
        f"/api/v1/runtime/streams/{sid}/mapping-ui/save",
        json={
            "mapping": {
                "event_array_path": "$.items",
                "field_mappings": {"event_id": "$.id"},
                "raw_payload_mode": "JSON_TREE",
            },
            "enrichment": {
                "enabled": True,
                "enrichment": {"vendor": "Acme"},
                "override_policy": "KEEP_EXISTING",
            },
            "route_formatters": [
                {"route_id": h["route_a_id"], "formatter_config": {"message_format": "json"}},
                {"route_id": h["route_b_id"], "formatter_config": {"message_format": "plain"}},
            ],
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["stream_id"] == sid
    assert body["mapping_saved"] is True
    assert body["enrichment_saved"] is True
    assert body["route_formatter_saved_count"] == 2
    assert body["route_formatter_route_ids"] == [h["route_a_id"], h["route_b_id"]]


def test_mapping_ui_save_mapping_only_success(mapping_ui_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    r = mapping_ui_save_client.post(
        f"/api/v1/runtime/streams/{sid}/mapping-ui/save",
        json={"mapping": {"event_array_path": "$.items", "field_mappings": {"id": "$.id"}}},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["mapping_saved"] is True
    assert body["enrichment_saved"] is False
    assert body["route_formatter_saved_count"] == 0


def test_mapping_ui_save_enrichment_only_success(mapping_ui_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    r = mapping_ui_save_client.post(
        f"/api/v1/runtime/streams/{sid}/mapping-ui/save",
        json={"enrichment": {"enabled": False, "enrichment": {"vendor": "Acme"}, "override_policy": "OVERRIDE"}},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["mapping_saved"] is False
    assert body["enrichment_saved"] is True
    assert body["route_formatter_saved_count"] == 0


def test_mapping_ui_save_multiple_route_formatters_success(
    mapping_ui_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    r = mapping_ui_save_client.post(
        f"/api/v1/runtime/streams/{sid}/mapping-ui/save",
        json={
            "route_formatters": [
                {"route_id": h["route_a_id"], "formatter_config": {"tag": "a"}},
                {"route_id": h["route_b_id"], "formatter_config": {"tag": "b"}},
            ]
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["route_formatter_saved_count"] == 2
    assert body["route_formatter_route_ids"] == [h["route_a_id"], h["route_b_id"]]


def test_mapping_ui_save_stream_not_found(mapping_ui_save_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    r = mapping_ui_save_client.post(
        "/api/v1/runtime/streams/999999999/mapping-ui/save",
        json={"mapping": {"field_mappings": {"id": "$.id"}}},
    )
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "STREAM_NOT_FOUND"


def test_mapping_ui_save_route_not_found(mapping_ui_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    r = mapping_ui_save_client.post(
        f"/api/v1/runtime/streams/{h['stream_id']}/mapping-ui/save",
        json={"route_formatters": [{"route_id": 999999999, "formatter_config": {"tag": "x"}}]},
    )
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "ROUTE_NOT_FOUND"


def test_mapping_ui_save_route_belongs_to_other_stream_returns_404(
    mapping_ui_save_client: TestClient,
    db_session: Session,
) -> None:
    h1 = _seed_stream_two_routes(db_session)
    h2 = _seed_stream_two_routes(db_session)
    r = mapping_ui_save_client.post(
        f"/api/v1/runtime/streams/{h1['stream_id']}/mapping-ui/save",
        json={"route_formatters": [{"route_id": h2["route_a_id"], "formatter_config": {"tag": "x"}}]},
    )
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "ROUTE_NOT_FOUND"


def test_mapping_ui_save_empty_field_mappings_returns_422(
    mapping_ui_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    r = mapping_ui_save_client.post(
        f"/api/v1/runtime/streams/{h['stream_id']}/mapping-ui/save",
        json={"mapping": {"field_mappings": {}}},
    )
    assert r.status_code == 422


def test_mapping_ui_save_empty_formatter_config_returns_422(
    mapping_ui_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    r = mapping_ui_save_client.post(
        f"/api/v1/runtime/streams/{h['stream_id']}/mapping-ui/save",
        json={"route_formatters": [{"route_id": h["route_a_id"], "formatter_config": {}}]},
    )
    assert r.status_code == 422


def test_mapping_ui_save_invalid_override_policy_returns_422(
    mapping_ui_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    r = mapping_ui_save_client.post(
        f"/api/v1/runtime/streams/{h['stream_id']}/mapping-ui/save",
        json={"enrichment": {"enrichment": {"vendor": "A"}, "override_policy": "fill_missing"}},
    )
    assert r.status_code == 422


def test_mapping_ui_save_success_commit_once(
    monkeypatch: pytest.MonkeyPatch,
    mapping_ui_save_client: TestClient,
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
    r = mapping_ui_save_client.post(
        f"/api/v1/runtime/streams/{sid}/mapping-ui/save",
        json={
            "mapping": {"field_mappings": {"id": "$.id"}},
            "enrichment": {"enrichment": {"vendor": "Acme"}},
            "route_formatters": [{"route_id": h["route_a_id"], "formatter_config": {"tag": "x"}}],
        },
    )
    assert r.status_code == 200
    assert commits["n"] == 1


def test_mapping_ui_save_failure_commit_none(
    monkeypatch: pytest.MonkeyPatch,
    mapping_ui_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    commits = {"n": 0}
    real_commit = Session.commit

    def _count_commit(self: Session, *args: Any, **kwargs: Any) -> None:
        commits["n"] += 1
        return real_commit(self, *args, **kwargs)

    monkeypatch.setattr(Session, "commit", _count_commit)
    r = mapping_ui_save_client.post(
        f"/api/v1/runtime/streams/{h['stream_id']}/mapping-ui/save",
        json={"route_formatters": [{"route_id": 999999999, "formatter_config": {"tag": "x"}}]},
    )
    assert r.status_code == 404
    assert commits["n"] == 0


def test_mapping_ui_save_core_entities_unchanged(
    mapping_ui_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    stream = db_session.query(Stream).filter(Stream.id == sid).one()
    source = db_session.query(Source).filter(Source.id == stream.source_id).one()
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

    before_stream = (bool(stream.enabled), stream.status, dict(stream.config_json or {}))
    before_source_cfg = dict(source.config_json or {})
    before_dest = (destination.name, dict(destination.config_json or {}), bool(destination.enabled))
    before_cp = (checkpoint.checkpoint_type, dict(checkpoint.checkpoint_value_json or {}))
    before_logs = db_session.query(DeliveryLog).count()

    r = mapping_ui_save_client.post(
        f"/api/v1/runtime/streams/{sid}/mapping-ui/save",
        json={
            "mapping": {"field_mappings": {"id": "$.id"}},
            "enrichment": {"enrichment": {"vendor": "Acme"}},
            "route_formatters": [{"route_id": h["route_a_id"], "formatter_config": {"tag": "x"}}],
        },
    )
    assert r.status_code == 200

    db_session.expire_all()
    stream2 = db_session.query(Stream).filter(Stream.id == sid).one()
    source2 = db_session.query(Source).filter(Source.id == source.id).one()
    destination2 = db_session.query(Destination).filter(Destination.id == destination.id).one()
    checkpoint2 = db_session.query(Checkpoint).filter(Checkpoint.stream_id == sid).one()

    assert (bool(stream2.enabled), stream2.status, dict(stream2.config_json or {})) == before_stream
    assert dict(source2.config_json or {}) == before_source_cfg
    assert (destination2.name, dict(destination2.config_json or {}), bool(destination2.enabled)) == before_dest
    assert (checkpoint2.checkpoint_type, dict(checkpoint2.checkpoint_value_json or {})) == before_cp
    assert db_session.query(DeliveryLog).count() == before_logs


def test_mapping_save_regression_still_works(mapping_ui_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    r = mapping_ui_save_client.post(
        f"/api/v1/runtime/mappings/stream/{h['stream_id']}/save",
        json={"field_mappings": {"event_id": "$.id"}},
    )
    assert r.status_code == 200


def test_enrichment_save_regression_still_works(mapping_ui_save_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    r = mapping_ui_save_client.post(
        f"/api/v1/runtime/enrichments/stream/{h['stream_id']}/save",
        json={"enrichment": {"vendor": "Acme"}},
    )
    assert r.status_code == 200


def test_route_formatter_save_regression_still_works(
    mapping_ui_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    r = mapping_ui_save_client.post(
        f"/api/v1/runtime/routes/{h['route_a_id']}/formatter/save",
        json={"formatter_config": {"message_format": "json"}},
    )
    assert r.status_code == 200


def test_mapping_ui_config_read_regression_still_works(
    mapping_ui_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    r = mapping_ui_save_client.get(f"/api/v1/runtime/streams/{h['stream_id']}/mapping-ui/config")
    assert r.status_code == 200
    assert r.json()["stream_id"] == h["stream_id"]
