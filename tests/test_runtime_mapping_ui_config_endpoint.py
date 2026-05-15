from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db
from app.enrichments.models import Enrichment
from app.main import app
from app.mappings.models import Mapping
from app.routes.models import Route
from app.destinations.models import Destination

from tests.test_runtime_logs_page_endpoint import _seed_stream_two_routes


@pytest.fixture
def mapping_ui_config_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_mapping_ui_config_full_success(
    mapping_ui_config_client: TestClient,
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

    r = mapping_ui_config_client.get(f"/api/v1/runtime/streams/{sid}/mapping-ui/config")
    assert r.status_code == 200
    body = r.json()
    assert body["stream_id"] == sid
    assert body["stream_name"] == "logpage-stream"
    assert body["source_type"] == "HTTP_API_POLLING"
    assert isinstance(body["source_config"], dict)
    assert body["mapping"]["exists"] is True
    assert body["mapping"]["event_array_path"] == "$.items"
    assert body["mapping"]["field_mappings"] == {"event_id": "$.id"}
    assert body["mapping"]["raw_payload_mode"] == "JSON_TREE"
    assert body["enrichment"]["exists"] is True
    assert body["enrichment"]["enabled"] is True
    assert body["enrichment"]["enrichment"] == {"vendor": "Acme"}
    assert body["enrichment"]["override_policy"] == "KEEP_EXISTING"
    assert len(body["routes"]) == 2
    assert all("route_id" in row for row in body["routes"])


def test_mapping_ui_config_mapping_default_when_missing(
    mapping_ui_config_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.query(Mapping).filter(Mapping.stream_id == sid).delete()
    db_session.commit()

    r = mapping_ui_config_client.get(f"/api/v1/runtime/streams/{sid}/mapping-ui/config")
    assert r.status_code == 200
    mapping = r.json()["mapping"]
    assert mapping["exists"] is False
    assert mapping["event_array_path"] is None
    assert mapping["field_mappings"] == {}
    assert mapping["raw_payload_mode"] is None


def test_mapping_ui_config_enrichment_default_when_missing(
    mapping_ui_config_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.query(Enrichment).filter(Enrichment.stream_id == sid).delete()
    db_session.commit()

    r = mapping_ui_config_client.get(f"/api/v1/runtime/streams/{sid}/mapping-ui/config")
    assert r.status_code == 200
    enr = r.json()["enrichment"]
    assert enr["exists"] is False
    assert enr["enabled"] is False
    assert enr["enrichment"] == {}
    assert enr["override_policy"] is None


def test_mapping_ui_config_routes_empty_when_no_routes(
    mapping_ui_config_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.query(Route).filter(Route.stream_id == sid).delete()
    db_session.commit()

    r = mapping_ui_config_client.get(f"/api/v1/runtime/streams/{sid}/mapping-ui/config")
    assert r.status_code == 200
    assert r.json()["routes"] == []


def test_mapping_ui_config_includes_disabled_route(
    mapping_ui_config_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    route = db_session.query(Route).filter(Route.id == h["route_a_id"]).one()
    route.enabled = False
    db_session.commit()

    r = mapping_ui_config_client.get(f"/api/v1/runtime/streams/{h['stream_id']}/mapping-ui/config")
    assert r.status_code == 200
    routes = {row["route_id"]: row for row in r.json()["routes"]}
    assert routes[h["route_a_id"]]["route_enabled"] is False


def test_mapping_ui_config_includes_disabled_destination(
    mapping_ui_config_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    dest = db_session.query(Destination).filter(Destination.id == h["dest_a_id"]).one()
    dest.enabled = False
    db_session.commit()

    r = mapping_ui_config_client.get(f"/api/v1/runtime/streams/{h['stream_id']}/mapping-ui/config")
    assert r.status_code == 200
    routes = {row["destination_id"]: row for row in r.json()["routes"]}
    assert routes[h["dest_a_id"]]["destination_enabled"] is False


def test_mapping_ui_config_stream_not_found_returns_404(
    mapping_ui_config_client: TestClient,
    db_session: Session,
) -> None:
    _seed_stream_two_routes(db_session)
    db_session.commit()

    r = mapping_ui_config_client.get("/api/v1/runtime/streams/999999999/mapping-ui/config")
    assert r.status_code == 404
    detail = r.json()["detail"]
    assert detail["error_code"] == "STREAM_NOT_FOUND"


def test_mapping_ui_config_does_not_use_db_commit_or_rollback(
    monkeypatch: pytest.MonkeyPatch,
    mapping_ui_config_client: TestClient,
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

    r = mapping_ui_config_client.get(f"/api/v1/runtime/streams/{h['stream_id']}/mapping-ui/config")
    assert r.status_code == 200
    assert called["commit"] == 0
    assert called["rollback"] == 0


def test_mapping_save_regression_still_works(
    mapping_ui_config_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    r = mapping_ui_config_client.post(
        f"/api/v1/runtime/mappings/stream/{h['stream_id']}/save",
        json={"field_mappings": {"event_id": "$.id"}},
    )
    assert r.status_code == 200


def test_enrichment_save_regression_still_works(
    mapping_ui_config_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    r = mapping_ui_config_client.post(
        f"/api/v1/runtime/enrichments/stream/{h['stream_id']}/save",
        json={"enrichment": {"vendor": "Acme"}},
    )
    assert r.status_code == 200


def test_route_formatter_save_regression_still_works(
    mapping_ui_config_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    r = mapping_ui_config_client.post(
        f"/api/v1/runtime/routes/{h['route_a_id']}/formatter/save",
        json={"formatter_config": {"message_format": "json"}},
    )
    assert r.status_code == 200


def test_e2e_draft_preview_regression_still_works(
    mapping_ui_config_client: TestClient,
    db_session: Session,
) -> None:
    _seed_stream_two_routes(db_session)
    r = mapping_ui_config_client.post(
        "/api/v1/runtime/preview/e2e-draft",
        json={
            "payload": {"items": [{"id": "evt-1"}]},
            "event_array_path": "$.items",
            "field_mappings": {"event_id": "$.id"},
            "destination_type": "WEBHOOK_POST",
            "formatter_config": {},
        },
    )
    assert r.status_code == 200
