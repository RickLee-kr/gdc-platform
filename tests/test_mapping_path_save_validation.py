"""Save-time validation for extracted-event-relative mapping paths."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db
from app.main import app
from app.mappings.models import Mapping

from tests.test_runtime_logs_page_endpoint import _seed_stream_two_routes


@pytest.fixture
def mapping_save_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


RECORDS_EVENT_ROOT_BODY = {
    "event_array_path": "$.Records",
    "event_root_path": "$.event",
    "field_mappings": {"event_time": "$.eventTime"},
}

ROOT_ARRAY_BODY = {
    "event_array_path": "$",
    "field_mappings": {"record_id": "$.id"},
}


def test_mapping_save_allows_extracted_event_relative_paths(
    mapping_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.commit()

    for body in (
        RECORDS_EVENT_ROOT_BODY,
        ROOT_ARRAY_BODY,
        {
            "event_array_path": "$.Records",
            "event_root_path": "$.event",
            "field_mappings": {"user_name": "$.user.name"},
        },
    ):
        r = mapping_save_client.post(f"/api/v1/runtime/mappings/stream/{sid}/save", json=body)
        assert r.status_code == 200, r.text


@pytest.mark.parametrize(
    ("event_array_path", "event_root_path", "field_mappings"),
    [
        ("$.Records", "$.event", {"event_time": "$.Records[0].event.eventTime"}),
        ("$.Records", "$.event", {"event_time": "$.Records[*].event.eventTime"}),
        ("$", None, {"record_id": "$[0].id"}),
        ("$", None, {"record_id": "$[*].id"}),
    ],
)
def test_mapping_save_rejects_envelope_relative_paths_on_create(
    mapping_save_client: TestClient,
    db_session: Session,
    event_array_path: str,
    event_root_path: str | None,
    field_mappings: dict[str, str],
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.commit()

    r = mapping_save_client.post(
        f"/api/v1/runtime/mappings/stream/{sid}/save",
        json={
            "event_array_path": event_array_path,
            "event_root_path": event_root_path,
            "field_mappings": field_mappings,
        },
    )
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["error_code"] == "ENVELOPE_RELATIVE_MAPPING_PATH"
    assert db_session.query(Mapping).filter(Mapping.stream_id == sid).count() == 0


def test_mapping_save_rejects_envelope_relative_paths_on_update(
    mapping_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.commit()

    ok = mapping_save_client.post(
        f"/api/v1/runtime/mappings/stream/{sid}/save",
        json=RECORDS_EVENT_ROOT_BODY,
    )
    assert ok.status_code == 200

    r = mapping_save_client.post(
        f"/api/v1/runtime/mappings/stream/{sid}/save",
        json={
            "event_array_path": "$.Records",
            "event_root_path": "$.event",
            "field_mappings": {"event_time": "$.Records[*].event.eventTime"},
        },
    )
    assert r.status_code == 422
    db_session.expire_all()
    row = db_session.query(Mapping).filter(Mapping.stream_id == sid).one()
    assert row.field_mappings_json == {"event_time": "$.eventTime"}


def test_mapping_ui_save_rejects_envelope_relative_paths(
    mapping_save_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    sid = h["stream_id"]
    db_session.commit()

    r = mapping_save_client.post(
        f"/api/v1/runtime/streams/{sid}/mapping-ui/save",
        json={
            "mapping": {
                "event_array_path": "$.Records",
                "event_root_path": "$.event",
                "field_mappings": {"event_time": "$.Records[0].event.eventTime"},
            },
            "enrichment": {"enabled": True, "enrichment": {}, "override_policy": "KEEP_EXISTING"},
        },
    )
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["error_code"] == "ENVELOPE_RELATIVE_MAPPING_PATH"


def test_mapping_validate_rejects_envelope_relative_paths() -> None:
    from fastapi.testclient import TestClient

    client = TestClient(app)
    r = client.post(
        "/api/v1/runtime/preview/mapping-validate",
        json={
            "event_array_path": "$.Records",
            "event_root_path": "$.event",
            "field_mappings": {"event_time": "$.Records[*].event.eventTime"},
            "payload": {"Records": [{"event": {"eventTime": "2024-01-01T00:00:00Z"}}]},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert any(w["code"] == "ENVELOPE_RELATIVE_MAPPING_PATH" for w in body["warnings"])
