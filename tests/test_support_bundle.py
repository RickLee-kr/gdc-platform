from __future__ import annotations

import io
import json
import zipfile
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.jwt_service import issue_access_token
from app.connectors.models import Connector
from app.database import get_db
from app.logs.models import DeliveryLog
from app.main import app
from app.sources.models import Source

EXPECTED_FILES = frozenset(
    {
        "manifest.json",
        "app_version_config.json",
        "runtime_health.json",
        "connectors.json",
        "sources.json",
        "streams.json",
        "destinations.json",
        "routes.json",
        "delivery_logs_recent.json",
        "audit_logs_recent.json",
        "retention_and_config_versions.json",
        "checkpoints.json",
        "backend_frontend_metadata.json",
    }
)


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
        username=f"{role.lower()}-sb",
        user_id=user_id,
        role=role,
        token_version=1,
    )
    return {"Authorization": f"Bearer {token}"}


def test_support_bundle_requires_administrator(client: TestClient) -> None:
    for role in ("VIEWER", "OPERATOR"):
        r = client.get("/api/v1/admin/support-bundle", headers=_bearer(role))
        assert r.status_code == 403, (role, r.text)
        detail = r.json()["detail"]
        assert detail["error_code"] == "ROLE_FORBIDDEN"


def test_support_bundle_zip_structure_and_masking(client: TestClient, db_session: Session) -> None:
    conn = Connector(name="c1", description="d", status="STOPPED")
    db_session.add(conn)
    db_session.flush()
    leak = "LEAK_SOURCE_SECRET_VALUE_XY123"
    src = Source(
        connector_id=conn.id,
        source_type="HTTP_API_POLLING",
        config_json={"secret_key": leak},
        auth_json={"bearer_token": "tok-abc"},
        enabled=True,
    )
    db_session.add(src)
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
            message="-----BEGIN CERTIFICATE-----\nLINE\n-----END CERTIFICATE-----",
            payload_sample={"secret_key": "in-payload"},
            retry_count=0,
        )
    )
    db_session.commit()

    r = client.get("/api/v1/admin/support-bundle", headers=_bearer("ADMINISTRATOR"))
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").split(";")[0].strip() == "application/zip"
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd.lower()
    assert ".zip" in cd

    raw = r.content
    assert leak.encode() not in raw
    assert b"tok-abc" not in raw
    assert b"BEGIN CERTIFICATE" not in raw

    zf = zipfile.ZipFile(io.BytesIO(raw))
    assert set(zf.namelist()) == EXPECTED_FILES

    sources = json.loads(zf.read("sources.json"))
    row = next(s for s in sources if s["id"] == src.id)
    assert row["config_json"]["secret_key"] == "********"
    assert row["auth_json"]["bearer_token"] == "********"

    logs = json.loads(zf.read("delivery_logs_recent.json"))
    assert logs[0]["message"] == "********"
    assert logs[0]["payload_sample"]["secret_key"] == "********"

    meta = json.loads(zf.read("backend_frontend_metadata.json"))
    assert meta["backend_settings_metadata"]["SECRET_KEY"] == "********"


def test_support_bundle_masks_dev_lab_ssh_passwords(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.config import settings

    leak = "LEAK_DEV_SSH_PASSWORD_XYZ9"
    monkeypatch.setattr(settings, "DEV_VALIDATION_SFTP_PASSWORD", leak, raising=False)
    monkeypatch.setattr(settings, "DEV_VALIDATION_SSH_SCP_PASSWORD", "other-" + leak, raising=False)

    r = client.get("/api/v1/admin/support-bundle", headers=_bearer("ADMINISTRATOR"))
    assert r.status_code == 200, r.text
    raw = r.content
    assert leak.encode() not in raw
    assert ("other-" + leak).encode() not in raw

    zf = zipfile.ZipFile(io.BytesIO(raw))
    meta = json.loads(zf.read("backend_frontend_metadata.json"))
    assert meta["backend_settings_metadata"]["DEV_VALIDATION_SFTP_PASSWORD"] == "********"
    assert meta["backend_settings_metadata"]["DEV_VALIDATION_SSH_SCP_PASSWORD"] == "********"
