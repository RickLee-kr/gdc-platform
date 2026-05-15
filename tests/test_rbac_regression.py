"""RBAC-lite regression coverage for the full pytest suite (JWT + anonymous admin)."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.jwt_service import issue_access_token
from app.connectors.models import Connector
from app.database import get_db
from app.main import app
from app.sources.models import Source


def _admin_bearer() -> dict[str, str]:
    token, _ = issue_access_token(
        username="pytest-admin",
        user_id=1,
        role="ADMINISTRATOR",
        token_version=1,
    )
    return {"Authorization": f"Bearer {token}"}


def _viewer_bearer() -> dict[str, str]:
    token, _ = issue_access_token(
        username="pytest-viewer",
        user_id=2,
        role="VIEWER",
        token_version=1,
    )
    return {"Authorization": f"Bearer {token}"}


def _operator_bearer() -> dict[str, str]:
    token, _ = issue_access_token(
        username="pytest-operator",
        user_id=3,
        role="OPERATOR",
        token_version=1,
    )
    return {"Authorization": f"Bearer {token}"}


def _connector_payload() -> dict[str, Any]:
    return {
        "name": "rbac-regression-connector",
        "description": "rbac regression",
        "base_url": "https://api.example.com",
        "verify_ssl": True,
        "auth_type": "no_auth",
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


def test_connector_create_succeeds_with_administrator_bearer(client: TestClient) -> None:
    res = client.post("/api/v1/connectors/", headers=_admin_bearer(), json=_connector_payload())
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "rbac-regression-connector"
    assert body["auth_type"] == "no_auth"


def test_connector_create_succeeds_anonymous_when_require_auth_false(client: TestClient) -> None:
    """Matches legacy integration tests: no bearer → anonymous administrator (spec 020)."""

    res = client.post("/api/v1/connectors/", json=_connector_payload())
    assert res.status_code == 201, res.text


def test_viewer_post_connector_returns_403_json(client: TestClient) -> None:
    res = client.post("/api/v1/connectors/", headers=_viewer_bearer(), json=_connector_payload())
    assert res.status_code == 403
    detail = res.json()["detail"]
    assert detail["error_code"] == "ROLE_FORBIDDEN"
    assert detail["role"] == "VIEWER"


def test_operator_retention_dry_run_allowed(client: TestClient) -> None:
    res = client.post("/api/v1/retention/run", headers=_operator_bearer(), json={"dry_run": True})
    assert res.status_code == 200, res.text


def test_stream_create_with_administrator_bearer(client: TestClient, db_session: Session) -> None:
    connector = Connector(name="rbac-stream-connector", description=None, status="RUNNING")
    db_session.add(connector)
    db_session.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={},
        auth_json={"auth_type": "no_auth"},
        enabled=True,
    )
    db_session.add(source)
    db_session.commit()
    db_session.refresh(connector)
    db_session.refresh(source)

    payload = {
        "name": "rbac-regression-stream",
        "connector_id": connector.id,
        "source_id": source.id,
        "polling_interval": 30,
        "enabled": True,
        "status": "STOPPED",
        "stream_type": "HTTP_API_POLLING",
        "config_json": {"endpoint": "/events"},
        "rate_limit_json": {"max_requests": 60, "per_seconds": 60},
    }
    res = client.post("/api/v1/streams/", headers=_admin_bearer(), json=payload)
    assert res.status_code == 201, res.text
    assert res.json()["name"] == "rbac-regression-stream"
