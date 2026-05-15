from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_final_event_draft_preview_mapping_plus_enrichment_success() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/final-event-draft",
        json={
            "payload": {"items": [{"id": "evt-1", "msg": "hello"}]},
            "event_array_path": "$.items",
            "field_mappings": {"event_id": "$.id", "message": "$.msg"},
            "enrichment": {"vendor": "Acme"},
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["input_event_count"] == 1
    assert body["preview_event_count"] == 1
    assert body["mapped_events"][0] == {"event_id": "evt-1", "message": "hello"}
    assert body["final_events"][0] == {"event_id": "evt-1", "message": "hello", "vendor": "Acme"}


def test_final_event_draft_preview_keep_existing_policy() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/final-event-draft",
        json={
            "payload": {"items": [{"id": "evt-1", "vendor": "Original"}]},
            "event_array_path": "$.items",
            "field_mappings": {"event_id": "$.id", "vendor": "$.vendor"},
            "enrichment": {"vendor": "Acme"},
            "override_policy": "KEEP_EXISTING",
        },
    )
    assert response.status_code == 200
    assert response.json()["final_events"][0]["vendor"] == "Original"


def test_final_event_draft_preview_override_policy() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/final-event-draft",
        json={
            "payload": {"items": [{"id": "evt-1", "vendor": "Original"}]},
            "event_array_path": "$.items",
            "field_mappings": {"event_id": "$.id", "vendor": "$.vendor"},
            "enrichment": {"vendor": "Acme"},
            "override_policy": "OVERRIDE",
        },
    )
    assert response.status_code == 200
    assert response.json()["final_events"][0]["vendor"] == "Acme"


def test_final_event_draft_preview_error_on_conflict_returns_400() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/final-event-draft",
        json={
            "payload": {"items": [{"id": "evt-1", "vendor": "Original"}]},
            "event_array_path": "$.items",
            "field_mappings": {"event_id": "$.id", "vendor": "$.vendor"},
            "enrichment": {"vendor": "Acme"},
            "override_policy": "ERROR_ON_CONFLICT",
        },
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "ENRICHMENT_FAILED"


def test_final_event_draft_preview_missing_jsonpath_records_null_and_missing_fields() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/final-event-draft",
        json={
            "payload": [{"id": "e1"}, {"id": "e2"}],
            "field_mappings": {"event_id": "$.id", "missing_val": "$.not_found"},
            "enrichment": {},
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mapped_events"][0]["missing_val"] is None
    assert body["mapped_events"][1]["missing_val"] is None
    assert body["missing_fields"] == [
        {"output_field": "missing_val", "json_path": "$.not_found", "event_index": 0},
        {"output_field": "missing_val", "json_path": "$.not_found", "event_index": 1},
    ]


def test_final_event_draft_preview_event_array_path_success() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/final-event-draft",
        json={
            "payload": {"data": {"items": [{"id": "a1"}, {"id": "a2"}]}},
            "event_array_path": "$.data.items",
            "field_mappings": {"event_id": "$.id"},
            "enrichment": {"vendor": "Acme"},
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["input_event_count"] == 2
    assert [row["event_id"] for row in body["final_events"]] == ["a1", "a2"]


def test_final_event_draft_preview_root_list_payload_success() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/final-event-draft",
        json={
            "payload": [{"name": "n1"}, {"name": "n2"}],
            "field_mappings": {"name": "$.name"},
            "enrichment": {"vendor": "Acme"},
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["input_event_count"] == 2
    assert body["preview_event_count"] == 2
    assert [row["name"] for row in body["final_events"]] == ["n1", "n2"]


def test_final_event_draft_preview_max_events_limit_applied() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/final-event-draft",
        json={
            "payload": [{"id": f"e{i}"} for i in range(6)],
            "field_mappings": {"event_id": "$.id"},
            "enrichment": {"vendor": "Acme"},
            "max_events": 3,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["input_event_count"] == 6
    assert body["preview_event_count"] == 3
    assert len(body["mapped_events"]) == 3
    assert len(body["final_events"]) == 3


def test_final_event_draft_preview_invalid_jsonpath_returns_400() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/final-event-draft",
        json={
            "payload": {"id": "evt-1"},
            "field_mappings": {"event_id": "$.["},
            "enrichment": {},
        },
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "MAPPING_FAILED"


def test_final_event_draft_preview_invalid_event_array_path_returns_400() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/final-event-draft",
        json={
            "payload": {"items": "not-an-array"},
            "event_array_path": "$.items",
            "field_mappings": {"event_id": "$.id"},
            "enrichment": {},
        },
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "EVENT_EXTRACTION_FAILED"


def test_final_event_draft_preview_does_not_use_db_commit_or_rollback(monkeypatch) -> None:
    called = {"commit": 0, "rollback": 0}

    def _raise_commit(*args, **kwargs):  # noqa: ANN002, ANN003
        called["commit"] += 1
        raise AssertionError("DB commit should not be called")

    def _raise_rollback(*args, **kwargs):  # noqa: ANN002, ANN003
        called["rollback"] += 1
        raise AssertionError("DB rollback should not be called")

    monkeypatch.setattr("sqlalchemy.orm.session.Session.commit", _raise_commit)
    monkeypatch.setattr("sqlalchemy.orm.session.Session.rollback", _raise_rollback)
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/final-event-draft",
        json={
            "payload": {"id": "evt-1"},
            "field_mappings": {"event_id": "$.id"},
            "enrichment": {"vendor": "Acme"},
        },
    )
    assert response.status_code == 200
    assert called["commit"] == 0
    assert called["rollback"] == 0


def test_mapping_draft_preview_endpoint_regression_still_works() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/mapping-draft",
        json={
            "payload": {"id": "evt-1"},
            "field_mappings": {"event_id": "$.id"},
        },
    )
    assert response.status_code == 200
    assert response.json()["mapped_events"][0]["event_id"] == "evt-1"


def test_json_paths_endpoint_regression_still_works() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/json-paths",
        json={"payload": {"x": 1, "y": "a"}},
    )
    assert response.status_code == 200
    assert response.json()["total"] == 2


def test_mapping_preview_endpoint_regression_still_works() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/mapping",
        json={
            "raw_response": {"items": [{"id": "evt-1"}]},
            "event_array_path": "$.items",
            "field_mappings": {"event_id": "$.id"},
            "enrichment": {},
            "override_policy": "KEEP_EXISTING",
        },
    )
    assert response.status_code == 200
    assert response.json()["preview_events"][0]["event_id"] == "evt-1"
