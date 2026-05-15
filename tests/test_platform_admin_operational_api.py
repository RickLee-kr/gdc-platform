from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db
from app.main import app


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_retention_policy_roundtrip(client: TestClient) -> None:
    r = client.get("/api/v1/admin/retention-policy")
    assert r.status_code == 200
    body = r.json()
    assert "logs" in body
    assert body["logs"]["retention_days"] >= 1

    r2 = client.put("/api/v1/admin/retention-policy", json={"logs_retention_days": 45, "logs_enabled": True})
    assert r2.status_code == 200
    assert r2.json()["logs"]["retention_days"] == 45


def test_audit_log_list(client: TestClient) -> None:
    r = client.get("/api/v1/admin/audit-log?limit=10")
    assert r.status_code == 200
    data = r.json()
    assert "total" in data
    assert "items" in data


def test_config_versions_list(client: TestClient) -> None:
    r = client.get("/api/v1/admin/config-versions?limit=10")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] >= 0


def test_health_summary(client: TestClient) -> None:
    r = client.get("/api/v1/admin/health-summary")
    assert r.status_code == 200
    data = r.json()
    assert "metrics" in data
    assert len(data["metrics"]) >= 1


def test_alert_settings_roundtrip(client: TestClient) -> None:
    r = client.get("/api/v1/admin/alert-settings")
    assert r.status_code == 200
    rules = r.json()["rules"]
    assert isinstance(rules, list)

    first = dict(rules[0])
    first["enabled"] = not bool(first.get("enabled", True))
    r2 = client.put("/api/v1/admin/alert-settings", json={"rules": [first] + rules[1:]})
    assert r2.status_code == 200
    assert r2.json()["rules"][0]["enabled"] == first["enabled"]
