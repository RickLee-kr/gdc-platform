from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.backup.postman_parser import build_postman_import_draft, parse_postman_collection
from app.database import get_db
from app.main import app

SAMPLE_COLLECTION = {
    "info": {
        "name": "Vendor API",
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    "item": [
        {
            "name": "Events",
            "item": [
                {
                    "name": "List events",
                    "request": {
                        "method": "GET",
                        "header": [{"key": "Accept", "value": "application/json"}],
                        "url": {
                            "raw": "https://api.vendor.example/v1/events?limit=5",
                            "protocol": "https",
                            "host": ["api", "vendor", "example"],
                            "path": ["v1", "events"],
                            "query": [{"key": "limit", "value": "5"}],
                        },
                    },
                },
                {
                    "name": "Search",
                    "request": {
                        "method": "POST",
                        "header": [
                            {"key": "Content-Type", "value": "application/json"},
                            {"key": "Authorization", "value": "Bearer secret-token"},
                        ],
                        "body": {"mode": "raw", "raw": '{"q":"alerts"}'},
                        "url": "https://api.vendor.example/v1/search",
                    },
                },
            ],
        }
    ],
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


def test_parse_postman_collection_lists_requests() -> None:
    parsed = parse_postman_collection(SAMPLE_COLLECTION)
    assert not parsed.parse_errors
    assert len(parsed.items) == 2
    assert parsed.items[0].method == "GET"
    assert "events" in parsed.items[0].url_preview


def test_postman_draft_masks_bearer() -> None:
    parsed = parse_postman_collection(SAMPLE_COLLECTION)
    search = next(i for i in parsed.items if i.name == "Search")
    draft, _, errors = build_postman_import_draft(SAMPLE_COLLECTION, item_id=search.item_id)
    assert not errors
    assert draft is not None
    assert draft["connector"]["auth_type"] == "bearer"
    assert draft["connector"].get("bearer_token") == ""
    assert "secret-token" not in str(draft)


def test_api_postman_parse_lists_items(client: TestClient) -> None:
    res = client.post("/api/v1/backup/postman/parse", json={"collection": SAMPLE_COLLECTION})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert len(body["items"]) == 2
    assert body["draft"] is None


def test_api_postman_parse_builds_draft(client: TestClient) -> None:
    parsed = parse_postman_collection(SAMPLE_COLLECTION)
    item_id = parsed.items[0].item_id
    res = client.post(
        "/api/v1/backup/postman/parse",
        json={"collection": SAMPLE_COLLECTION, "item_id": item_id},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["draft"]["connector"]["base_url"] == "https://api.vendor.example"
    assert body["draft"]["stream"]["config_json"]["endpoint"] == "/v1/events"
    assert "secret-token" not in res.text


def test_api_postman_parse_rejects_v1(client: TestClient) -> None:
    res = client.post(
        "/api/v1/backup/postman/parse",
        json={"collection": {"info": {"name": "Legacy"}, "requests": []}},
    )
    assert res.status_code == 422
    assert res.json()["detail"]["error_code"] == "POSTMAN_PARSE_FAILED"
