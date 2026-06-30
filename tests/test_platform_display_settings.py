"""Platform display settings and user timezone preference."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_display_settings_round_trip(client: TestClient) -> None:
    get_resp = client.get("/api/v1/admin/display-settings")
    assert get_resp.status_code == 200
    body = get_resp.json()
    assert "default_timezone" in body

    put_resp = client.put(
        "/api/v1/admin/display-settings",
        json={"default_timezone": "Asia/Seoul"},
    )
    assert put_resp.status_code == 200
    assert put_resp.json()["default_timezone"] == "Asia/Seoul"

    who = client.get("/api/v1/auth/whoami")
    assert who.status_code == 200
    assert who.json().get("platform_default_timezone") == "Asia/Seoul"

    restore = client.put("/api/v1/admin/display-settings", json={"default_timezone": "UTC"})
    assert restore.status_code == 200


def test_whoami_includes_timezone_fields(client: TestClient) -> None:
    who = client.get("/api/v1/auth/whoami")
    assert who.status_code == 200
    data = who.json()
    assert "platform_default_timezone" in data
    assert "timezone" in data


def test_invalid_timezone_rejected(client: TestClient) -> None:
    resp = client.put("/api/v1/admin/display-settings", json={"default_timezone": "Not/A/Zone"})
    assert resp.status_code == 422
