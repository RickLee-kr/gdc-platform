from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.jwt_service import issue_access_token
from app.connectors.models import Connector
from app.database import get_db
from app.logs.models import DeliveryLog
from app.main import app
from app.config import settings


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def _bearer(role: str, *, user_id: int = 1) -> dict[str, str]:
    token, _ = issue_access_token(
        username=f"{role.lower()}-mh",
        user_id=user_id,
        role=role,
        token_version=1,
    )
    return {"Authorization": f"Bearer {token}"}


def test_maintenance_health_requires_administrator(client: TestClient) -> None:
    for role in ("VIEWER", "OPERATOR"):
        r = client.get("/api/v1/admin/maintenance/health", headers=_bearer(role))
        assert r.status_code == 403, (role, r.text)
        assert r.json()["detail"]["error_code"] == "ROLE_FORBIDDEN"


def test_maintenance_health_administrator_ok_and_structure(client: TestClient) -> None:
    r = client.get("/api/v1/admin/maintenance/health", headers=_bearer("ADMINISTRATOR"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["overall"] in ("OK", "WARN", "ERROR")
    assert "generated_at" in body
    assert isinstance(body["ok"], list)
    assert isinstance(body["warn"], list)
    assert isinstance(body["error"], list)
    panels = body["panels"]
    for key in (
        "database",
        "migrations",
        "scheduler",
        "retention",
        "storage",
        "destinations",
        "certificates",
        "recent_failures",
        "delivery_logs_indexes",
        "support_bundle",
    ):
        assert key in panels
        assert panels[key].get("status") in ("OK", "WARN", "ERROR")


def test_maintenance_health_masks_database_url_and_payload(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, db_session: Session
) -> None:
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql://svc:MY_DB_PASSWORD_XYZ@db.internal:5432/gdc", raising=False)
    conn = Connector(name="c-mh", description="d", status="STOPPED")
    db_session.add(conn)
    db_session.flush()
    leak = "LEAK_PAYLOAD_SECRET_ABC"
    db_session.add(
        DeliveryLog(
            connector_id=conn.id,
            stream_id=None,
            route_id=None,
            destination_id=None,
            stage="route_send_failed",
            level="ERROR",
            status="FAIL",
            message="failure logged",
            payload_sample={"api_key": leak},
            retry_count=0,
        )
    )
    db_session.commit()

    r = client.get("/api/v1/admin/maintenance/health", headers=_bearer("ADMINISTRATOR"))
    assert r.status_code == 200, r.text
    raw = r.text
    assert "MY_DB_PASSWORD_XYZ" not in raw
    masked = r.json()["panels"]["database"]["database_url_masked"]
    assert "****" in masked or ":****@" in masked

    items = r.json()["panels"]["recent_failures"]["items"]
    assert items
    assert leak not in raw
    assert items[0].get("payload_sample_masked", {}).get("api_key") == "********"


def test_maintenance_overall_warn_when_recent_failures(client: TestClient, db_session: Session) -> None:
    conn = Connector(name="c-mh2", description="d", status="STOPPED")
    db_session.add(conn)
    db_session.flush()
    db_session.add(
        DeliveryLog(
            connector_id=conn.id,
            stream_id=None,
            route_id=None,
            destination_id=None,
            stage="route_send_failed",
            level="ERROR",
            status="FAIL",
            message="boom",
            payload_sample={},
            retry_count=0,
        )
    )
    db_session.commit()
    r = client.get("/api/v1/admin/maintenance/health", headers=_bearer("ADMINISTRATOR"))
    assert r.status_code == 200
    body = r.json()
    assert body["panels"]["recent_failures"]["status"] == "WARN"
    assert any(n["code"] == "RECENT_DELIVERY_FAILURES_PRESENT" for n in body["warn"])
    assert body["overall"] in ("WARN", "ERROR")
