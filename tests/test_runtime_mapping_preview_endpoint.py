from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_mapping_preview_success() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/mapping",
        json={
            "raw_response": {"items": [{"id": "evt-1", "message": "hello"}]},
            "event_array_path": "$.items",
            "field_mappings": {"event_id": "$.id", "message": "$.message"},
            "enrichment": {"vendor": "Acme", "product": "EDR"},
            "override_policy": "KEEP_EXISTING",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["input_event_count"] == 1
    assert body["mapped_event_count"] == 1
    assert body["preview_events"][0]["event_id"] == "evt-1"
    assert body["preview_events"][0]["vendor"] == "Acme"


def test_mapping_preview_extracts_by_event_array_path() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/mapping",
        json={
            "raw_response": {"data": {"alerts": [{"id": "a-1"}, {"id": "a-2"}]}},
            "event_array_path": "$.data.alerts",
            "field_mappings": {"event_id": "$.id"},
            "enrichment": {},
            "override_policy": "KEEP_EXISTING",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["input_event_count"] == 2
    assert [row["event_id"] for row in body["preview_events"]] == ["a-1", "a-2"]


def test_mapping_preview_keep_existing_policy() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/mapping",
        json={
            "raw_response": {"items": [{"id": "evt-1", "vendor": "OriginalVendor"}]},
            "event_array_path": "$.items",
            "field_mappings": {"event_id": "$.id", "vendor": "$.vendor"},
            "enrichment": {"vendor": "Acme"},
            "override_policy": "KEEP_EXISTING",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["preview_events"][0]["vendor"] == "OriginalVendor"


def test_mapping_preview_override_policy() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/mapping",
        json={
            "raw_response": {"items": [{"id": "evt-1", "vendor": "OriginalVendor"}]},
            "event_array_path": "$.items",
            "field_mappings": {"event_id": "$.id", "vendor": "$.vendor"},
            "enrichment": {"vendor": "Acme"},
            "override_policy": "OVERRIDE",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["preview_events"][0]["vendor"] == "Acme"


def test_mapping_preview_error_on_conflict_returns_400() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/mapping",
        json={
            "raw_response": {"items": [{"id": "evt-1", "vendor": "OriginalVendor"}]},
            "event_array_path": "$.items",
            "field_mappings": {"event_id": "$.id", "vendor": "$.vendor"},
            "enrichment": {"vendor": "Acme"},
            "override_policy": "ERROR_ON_CONFLICT",
        },
    )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "ENRICHMENT_FAILED"


def test_mapping_preview_invalid_jsonpath_returns_400() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/mapping",
        json={
            "raw_response": {"items": [{"id": "evt-1"}]},
            "event_array_path": "$.[",
            "field_mappings": {"event_id": "$.id"},
            "enrichment": {},
            "override_policy": "KEEP_EXISTING",
        },
    )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "EVENT_EXTRACTION_FAILED"


def test_mapping_preview_does_not_use_db_commit_or_rollback(monkeypatch) -> None:
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
        "/api/v1/runtime/preview/mapping",
        json={
            "raw_response": {"items": [{"id": "evt-1", "message": "hello"}]},
            "event_array_path": "$.items",
            "field_mappings": {"event_id": "$.id", "message": "$.message"},
            "enrichment": {"vendor": "Acme"},
            "override_policy": "KEEP_EXISTING",
        },
    )

    assert response.status_code == 200
    assert called["commit"] == 0
    assert called["rollback"] == 0

