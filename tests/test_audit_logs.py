"""Audit logs MVP — model, sanitization, and read API."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.audit.repository import count_audit_logs, list_audit_logs
from app.audit.service import record_audit_log, sanitize_audit_metadata
from app.auth.security import get_password_hash
from app.database import get_db, get_db_read_bounded
from app.main import app
from app.platform_admin.models import PlatformUser


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_db_read_bounded] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_db_read_bounded, None)


def _seed_user(db: Session, *, username: str, role: str, password: str) -> PlatformUser:
    row = PlatformUser(
        username=username,
        password_hash=get_password_hash(password),
        role=role,
        status="ACTIVE",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_sanitize_audit_metadata_masks_secrets() -> None:
    raw = {
        "password": "sekret",
        "nested": {"bearer_token": "tok123", "safe": "ok"},
        "pem": "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    }
    out = sanitize_audit_metadata(raw)
    assert out["password"] == "********"
    assert out["nested"]["bearer_token"] == "********"
    assert out["nested"]["safe"] == "ok"
    assert "BEGIN" not in str(out["pem"])


def test_repository_filters_by_action(db_session: Session) -> None:
    record_audit_log(
        db_session,
        action="CONNECTOR_CREATED",
        entity_type="CONNECTOR",
        entity_id=1,
        metadata={"entity_name": "A"},
    )
    record_audit_log(
        db_session,
        action="STREAM_CREATED",
        entity_type="STREAM",
        entity_id=2,
        metadata={"entity_name": "B"},
    )
    db_session.commit()
    assert count_audit_logs(db_session, action="CONNECTOR_CREATED") >= 1
    rows = list_audit_logs(db_session, action="CONNECTOR_CREATED", limit=5)
    assert all(r.action == "CONNECTOR_CREATED" for r in rows)


def test_record_audit_log_persists_row(db_session: Session) -> None:
    record_audit_log(
        db_session,
        action="CONNECTOR_CREATED",
        actor_username="op-a",
        entity_type="CONNECTOR",
        entity_id=42,
        metadata={"entity_name": "Acme", "password": "hidden"},
    )
    db_session.commit()
    row = db_session.query(AuditLog).order_by(AuditLog.id.desc()).first()
    assert row is not None
    assert row.action == "CONNECTOR_CREATED"
    assert row.entity_id == 42
    assert row.metadata_json.get("password") == "********"


def test_audit_logs_list_endpoint_filters(client: TestClient, db_session: Session) -> None:
    try:
        pw = get_password_hash("audit-pw-1")
    except ValueError:
        pytest.skip("bcrypt unavailable")
        return
    _seed_user(db_session, username="audit-op", role="OPERATOR", password="audit-pw-1")
    login = client.post("/api/v1/auth/login", json={"username": "audit-op", "password": "audit-pw-1"})
    assert login.status_code == 200
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    since = datetime.now(timezone.utc) - timedelta(minutes=5)
    r = client.get(
        "/api/v1/audit-logs",
        params={"action": "USER_LOGIN", "result": "success", "since": since.isoformat(), "limit": 10},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] >= 1
    assert any(item["action"] == "USER_LOGIN" for item in body["items"])
    assert all(item["result"] == "success" for item in body["items"])
    for item in body["items"]:
        meta = item.get("metadata_json") or {}
        assert "password" not in meta or meta.get("password") == "********"


def test_login_failure_records_audit_without_password(client: TestClient, db_session: Session) -> None:
    try:
        pw = get_password_hash("known-pw")
    except ValueError:
        pytest.skip("bcrypt unavailable")
        return
    _seed_user(db_session, username="fail-user", role="VIEWER", password="known-pw")

    r = client.post("/api/v1/auth/login", json={"username": "fail-user", "password": "wrong-pw"})
    assert r.status_code == 400

    row = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "USER_LOGIN_FAILED")
        .order_by(AuditLog.id.desc())
        .first()
    )
    assert row is not None
    assert row.result == "failure"
    meta = dict(row.metadata_json or {})
    assert "password" not in meta
    assert meta.get("reason") == "invalid_credentials"
