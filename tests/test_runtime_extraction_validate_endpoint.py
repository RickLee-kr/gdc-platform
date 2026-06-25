from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_extraction_validate_normalizes_indexed_array_path() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/extraction-validate",
        json={
            "payload": {"Records": [{"event": {"id": "a", "eventTime": 1}}]},
            "event_array_path": "$.Records[0]",
            "event_root_path": "$.event",
            "checkpoint_path": "$.eventTime",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["normalized_event_array_path"] == "$.Records"
    assert body["normalized_event_root_path"] == "$.event"
    assert body["normalized_checkpoint_path"] == "$.eventTime"
    assert body["event_count"] == 1
    assert body["checkpoint_values_preview"] == [1]
    assert any(item["code"] == "PREVIEW_INDEX_NORMALIZED" for item in body["warnings"])


def test_extraction_validate_handles_dynamic_key_object_map() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/extraction-validate",
        json={
            "payload": {
                "data": {
                    "resultIdToElementDataMap": {
                        "kFrA4R53fMqT0zlG": {"guidString": "kFrA4R53fMqT0zlG", "suspect": True, "createdAtTime": 123},
                        "kFrA4W0wfJwJJpu": {"guidString": "kFrA4W0wfJwJJpu", "suspect": False, "createdAtTime": 456},
                    }
                }
            },
            "event_array_path": "$.data.resultIdToElementDataMap.*",
            "checkpoint_path": "$.createdAtTime",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["event_count"] == 2
    assert len(body["preview_events"]) == 2
    assert sorted(body["checkpoint_values_preview"]) == [123, 456]


def test_extraction_validate_returns_error_for_invalid_event_root_path() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/extraction-validate",
        json={
            "payload": {"Records": [{"event": {"id": "a"}}]},
            "event_array_path": "$.Records",
            "event_root_path": "$.missing",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert any(item["code"] == "EVENT_EXTRACTION_FAILED" for item in body["errors"])
