"""HTTP integration checks for RBAC-lite (JWT + middleware + route_access)."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.jwt_service import issue_access_token
from app.database import get_db
from app.main import app


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def _bearer(role: str) -> dict[str, str]:
    token, _ = issue_access_token(username="rbac-t", user_id=1, role=role, token_version=1)
    return {"Authorization": f"Bearer {token}"}


def test_viewer_post_runtime_start_forbidden(client: TestClient) -> None:
    r = client.post("/api/v1/runtime/streams/1/start", headers=_bearer("VIEWER"))
    assert r.status_code == 403
    assert r.json()["detail"]["error_code"] == "ROLE_FORBIDDEN"


def test_viewer_post_runtime_preview_allowed(client: TestClient) -> None:
    r = client.post(
        "/api/v1/runtime/preview/mapping",
        headers={**_bearer("VIEWER"), "Content-Type": "application/json"},
        json={"stream_id": 1, "sample_event": {}, "mappings": []},
    )
    # Mapping validation may return 422 for empty payload; must not be 403 RBAC.
    assert r.status_code != 403


def test_operator_put_admin_https_forbidden(client: TestClient) -> None:
    r = client.put(
        "/api/v1/admin/https-settings",
        headers=_bearer("OPERATOR"),
        json={
            "enabled": False,
            "certificate_ip_addresses": [],
            "certificate_dns_names": [],
            "redirect_http_to_https": False,
            "certificate_valid_days": 365,
            "regenerate_certificate": False,
        },
    )
    assert r.status_code == 403


def test_operator_post_retention_run_allowed(client: TestClient) -> None:
    r = client.post("/api/v1/retention/run", headers=_bearer("OPERATOR"), json={"dry_run": True})
    assert r.status_code == 200


def test_viewer_post_retention_run_forbidden(client: TestClient) -> None:
    r = client.post("/api/v1/retention/run", headers=_bearer("VIEWER"), json={"dry_run": True})
    assert r.status_code == 403


def test_viewer_get_retention_status_allowed(client: TestClient) -> None:
    r = client.get("/api/v1/retention/status", headers=_bearer("VIEWER"))
    assert r.status_code == 200


def test_operator_post_backup_import_apply_forbidden(client: TestClient) -> None:
    r = client.post(
        "/api/v1/backup/import/apply",
        headers={**_bearer("OPERATOR"), "Content-Type": "application/json"},
        json={"bundle": {"version": 1, "connectors": []}, "mode": "additive", "preview_token": "x", "confirm": True},
    )
    assert r.status_code == 403


def test_viewer_post_auth_logout_allowed(client: TestClient) -> None:
    r = client.post("/api/v1/auth/logout", headers=_bearer("VIEWER"), json={"revoke_all": False})
    assert r.status_code == 204
