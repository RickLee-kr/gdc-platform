"""Tests for Template Draft inference and API."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db
from app.main import app
from app.templates.draft_storage import delete_draft_artifacts, drafts_root, read_draft_artifacts
from app.templates.inference.engine import run_sample_inference


SAMPLE_EVENTS = {
    "data": {
        "events": [
            {
                "id": "evt-1",
                "severity": "high",
                "timestamp": "2026-05-08T12:00:00Z",
                "tenant_id": "acme",
                "message": "Suspicious login",
            }
        ],
        "next_cursor": "cursor-abc",
    }
}


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_inference_detects_event_array_and_mapping() -> None:
    out = run_sample_inference(SAMPLE_EVENTS, vendor="acme", product="siem")
    assert out["event_array_path"] == "$.data.events"
    assert out["mapping_candidates"]
    assert any(c["output_field"] == "event_id" for c in out["mapping_candidates"])
    assert out["checkpoint_recommendation"] is not None
    assert out["normalized_event_preview"]


def test_create_list_and_delete_template_draft(client: TestClient) -> None:
    body = {
        "display_name": "Test events draft",
        "vendor": "acme",
        "product": "siem",
        "use_case": "security_events",
        "auth_type": "bearer",
        "import_source": "API_TEST_SAMPLE",
        "request_structure": {
            "method": "GET",
            "base_url": "https://api.acme.example",
            "endpoint": "/v1/events",
            "query_params": {"limit": "100"},
            "headers_masked": {"Accept": "application/json"},
        },
        "sample_payload": SAMPLE_EVENTS,
        "approved_inference": run_sample_inference(SAMPLE_EVENTS),
    }
    created = client.post("/api/v1/templates/drafts", json=body)
    assert created.status_code == 201, created.text
    draft_id = created.json()["id"]
    assert draft_id.startswith("draft-")

    listed = client.get("/api/v1/templates/drafts")
    assert listed.status_code == 200
    ids = [row["id"] for row in listed.json()]
    assert draft_id in ids

    detail = client.get(f"/api/v1/templates/drafts/{draft_id}")
    assert detail.status_code == 200
    assert detail.json()["display_name"] == "Test events draft"
    assert detail.json()["mapping_candidate"]

    artifacts = read_draft_artifacts(draft_id)
    assert artifacts["manifest"]["status"] == "draft"
    assert artifacts["request"]["endpoint"] == "/v1/events"
    assert artifacts["mapping"]["event_array_path"] == "$.data.events"

    cloned = client.post(f"/api/v1/templates/drafts/{draft_id}/clone")
    assert cloned.status_code == 201
    clone_id = cloned.json()["id"]
    assert clone_id != draft_id

    wizard = client.get(f"/api/v1/templates/drafts/{draft_id}/wizard-payload")
    assert wizard.status_code == 200
    assert wizard.json()["connector_draft"]["base_url"]

    deleted = client.delete(f"/api/v1/templates/drafts/{draft_id}")
    assert deleted.status_code == 204

    delete_draft_artifacts(clone_id)
    client.delete(f"/api/v1/templates/drafts/{clone_id}")


def test_preview_inference_endpoint(client: TestClient) -> None:
    res = client.post(
        "/api/v1/templates/drafts/preview-inference",
        json={"sample_payload": SAMPLE_EVENTS},
    )
    assert res.status_code == 200
    inference = res.json()["inference"]
    assert inference["event_array_path"] == "$.data.events"


def test_drafts_root_under_templates() -> None:
    root = drafts_root()
    assert str(root).endswith("templates/drafts")
