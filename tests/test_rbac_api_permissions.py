"""HTTP integration checks for RBAC-lite (JWT + middleware + route_access).

Covers Viewer / Operator / Administrator write-path matrix for workspace,
runtime control, backup/restore, admin settings, and governance mutations.
Forbidden Viewer requests must not mutate entity counts or append audit logs.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.auth.jwt_service import issue_access_token
from app.connectors.models import Connector
from app.database import get_db
from app.destinations.models import Destination
from app.main import app
from app.platform_admin.models import PlatformAuditEvent
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream


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
    token, _ = issue_access_token(username=f"rbac-{role.lower()}", user_id=1, role=role, token_version=1)
    return {"Authorization": f"Bearer {token}"}


def _json_headers(role: str) -> dict[str, str]:
    return {**_bearer(role), "Content-Type": "application/json"}


def _count(db: Session, model: type) -> int:
    return int(db.scalar(select(func.count()).select_from(model)) or 0)


def _audit_counts(db: Session) -> tuple[int, int]:
    return _count(db, AuditLog), _count(db, PlatformAuditEvent)


def _assert_forbidden(resp: Any, *, role: str | None = None) -> None:
    assert resp.status_code == 403, resp.text
    detail = resp.json()["detail"]
    assert detail["error_code"] in {
        "ROLE_FORBIDDEN",
        "GOVERNANCE_READ_FORBIDDEN",
        "GOVERNANCE_WRITE_FORBIDDEN",
        "GOVERNANCE_QUARANTINE_FORBIDDEN",
        "GOVERNANCE_REPLAY_FORBIDDEN",
        "GOVERNANCE_DASHBOARD_FORBIDDEN",
        "GOVERNANCE_OPERATIONS_FORBIDDEN",
        "GOVERNANCE_ACTIVATE_FORBIDDEN",
        "GOVERNANCE_APPROVAL_FORBIDDEN",
    }
    if role is not None:
        assert detail.get("role") == role


# --- Legacy smoke tests (kept) ---


def test_viewer_post_runtime_start_forbidden(client: TestClient) -> None:
    r = client.post("/api/v1/runtime/streams/1/start", headers=_bearer("VIEWER"))
    _assert_forbidden(r, role="VIEWER")


def test_viewer_post_runtime_preview_allowed(client: TestClient) -> None:
    r = client.post(
        "/api/v1/runtime/preview/mapping",
        headers=_json_headers("VIEWER"),
        json={"stream_id": 1, "sample_event": {}, "mappings": []},
    )
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
    _assert_forbidden(r)


def test_operator_post_retention_run_allowed(client: TestClient) -> None:
    r = client.post("/api/v1/retention/run", headers=_bearer("OPERATOR"), json={"dry_run": True})
    assert r.status_code == 200


def test_viewer_post_retention_run_forbidden(client: TestClient) -> None:
    r = client.post("/api/v1/retention/run", headers=_bearer("VIEWER"), json={"dry_run": True})
    _assert_forbidden(r, role="VIEWER")


def test_viewer_get_retention_status_allowed(client: TestClient) -> None:
    r = client.get("/api/v1/retention/status", headers=_bearer("VIEWER"))
    assert r.status_code == 200


def test_operator_post_backup_import_apply_forbidden(client: TestClient) -> None:
    r = client.post(
        "/api/v1/backup/import/apply",
        headers=_json_headers("OPERATOR"),
        json={"bundle": {"version": 1, "connectors": []}, "mode": "additive", "preview_token": "x", "confirm": True},
    )
    _assert_forbidden(r)


def test_viewer_post_auth_logout_allowed(client: TestClient) -> None:
    r = client.post("/api/v1/auth/logout", headers=_bearer("VIEWER"), json={"revoke_all": False})
    assert r.status_code == 204


# --- Parametrized Viewer write denials (no side effects) ---

_VIEWER_WRITE_CALLS: list[tuple[str, str, dict[str, Any] | None]] = [
    ("POST", "/api/v1/streams/", {"name": "v", "connector_id": 1, "source_id": 1, "polling_interval": 30, "enabled": True}),
    ("PUT", "/api/v1/streams/1", {"name": "v", "polling_interval": 30, "enabled": True}),
    ("DELETE", "/api/v1/streams/1", None),
    ("POST", "/api/v1/runtime/streams/1/start", None),
    ("POST", "/api/v1/runtime/streams/1/stop", None),
    ("POST", "/api/v1/runtime/streams/1/run-once", None),
    ("PUT", "/api/v1/runtime/streams/1/checkpoint", {"checkpoint_value": "x"}),
    ("POST", "/api/v1/runtime/streams/1/checkpoint/reset", None),
    ("POST", "/api/v1/runtime/streams/1/replay", {"mode": "from_checkpoint"}),
    ("POST", "/api/v1/runtime/quarantine-events/1/release", None),
    ("POST", "/api/v1/runtime/quarantine-events/1/discard", None),
    ("POST", "/api/v1/runtime/replay-events/1/replay", None),
    ("POST", "/api/v1/routes/", {"stream_id": 1, "destination_id": 1, "name": "r", "enabled": True}),
    ("PUT", "/api/v1/routes/1", {"name": "r", "enabled": True}),
    ("DELETE", "/api/v1/routes/1", None),
    ("POST", "/api/v1/connectors/", {"name": "c", "base_url": "https://example.com", "verify_ssl": True, "auth_type": "no_auth"}),
    ("PUT", "/api/v1/connectors/1", {"name": "c", "base_url": "https://example.com", "verify_ssl": True, "auth_type": "no_auth"}),
    ("DELETE", "/api/v1/connectors/1", None),
    ("POST", "/api/v1/connectors/1/auth-check", None),
    ("POST", "/api/v1/destinations/", {"name": "d", "destination_type": "HTTP", "enabled": True, "config_json": {}}),
    ("PUT", "/api/v1/destinations/1", {"name": "d", "enabled": True, "config_json": {}}),
    ("DELETE", "/api/v1/destinations/1", None),
    ("POST", "/api/v1/destinations/1/test", None),
    ("POST", "/api/v1/backup/import/preview", {"bundle": {"version": 1}}),
    ("POST", "/api/v1/backup/import/apply", {"bundle": {"version": 1}, "mode": "additive", "preview_token": "x", "confirm": True}),
    ("POST", "/api/v1/backup/streams/1/clone", {"name": "clone"}),
    ("PUT", "/api/v1/admin/display-settings", {"default_timezone": "UTC"}),
    ("PUT", "/api/v1/admin/https-settings", {"enabled": False, "certificate_ip_addresses": [], "certificate_dns_names": [], "redirect_http_to_https": False, "certificate_valid_days": 365, "regenerate_certificate": False}),
    ("PUT", "/api/v1/admin/retention-policy", {}),
    ("PUT", "/api/v1/admin/alert-settings", {}),
    ("POST", "/api/v1/admin/users", {"username": "x", "password": "x", "role": "VIEWER"}),
    ("POST", "/api/v1/retention/run", {"dry_run": True}),
    ("POST", "/api/v1/governance/policies", {"name": "p", "policy_type": "drop", "action": "quarantine"}),
    ("POST", "/api/v1/governance/quarantine/release", {"event_ids": [1]}),
    ("POST", "/api/v1/governance/quarantine/discard", {"event_ids": [1]}),
    ("POST", "/api/v1/governance/replay/1/execute", {}),
    ("POST", "/api/v1/governance/replay/bulk-execute", {"replay_ids": [1]}),
    ("POST", "/api/v1/backfill/replay", {"stream_id": 1}),
]


@pytest.mark.parametrize(("method", "path", "body"), _VIEWER_WRITE_CALLS)
def test_viewer_write_forbidden_no_side_effects(
    client: TestClient,
    db_session: Session,
    method: str,
    path: str,
    body: dict[str, Any] | None,
) -> None:
    before_streams = _count(db_session, Stream)
    before_routes = _count(db_session, Route)
    before_connectors = _count(db_session, Connector)
    before_destinations = _count(db_session, Destination)
    before_audit = _audit_counts(db_session)

    headers = _json_headers("VIEWER") if body is not None else _bearer("VIEWER")
    if method == "POST":
        resp = client.post(path, headers=headers, json=body)
    elif method == "PUT":
        resp = client.put(path, headers=headers, json=body or {})
    elif method == "DELETE":
        resp = client.delete(path, headers=headers)
    else:
        raise AssertionError(method)

    _assert_forbidden(resp, role="VIEWER")
    db_session.expire_all()
    assert _count(db_session, Stream) == before_streams
    assert _count(db_session, Route) == before_routes
    assert _count(db_session, Connector) == before_connectors
    assert _count(db_session, Destination) == before_destinations
    assert _audit_counts(db_session) == before_audit


# --- Operator allow / deny ---


def test_operator_workspace_mutations_not_role_forbidden(client: TestClient, db_session: Session) -> None:
    """Operator may reach workspace handlers (may 4xx on validation, never ROLE_FORBIDDEN)."""
    connector = Connector(name="rbac-op-conn", description=None, status="RUNNING")
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

    r = client.post(
        "/api/v1/streams/",
        headers=_json_headers("OPERATOR"),
        json={
            "name": "rbac-op-stream",
            "connector_id": connector.id,
            "source_id": source.id,
            "polling_interval": 30,
            "enabled": True,
            "status": "STOPPED",
        },
    )
    assert r.status_code != 403, r.text
    assert r.status_code in {200, 201}


def test_operator_admin_exclusive_forbidden(client: TestClient) -> None:
    for method, path, body in [
        ("PUT", "/api/v1/admin/https-settings", {"enabled": False, "certificate_ip_addresses": [], "certificate_dns_names": [], "redirect_http_to_https": False, "certificate_valid_days": 365, "regenerate_certificate": False}),
        ("POST", "/api/v1/backup/import/apply", {"bundle": {"version": 1}, "mode": "additive", "preview_token": "x", "confirm": True}),
        ("POST", "/api/v1/governance/quarantine/release", {"event_ids": [1]}),
        ("POST", "/api/v1/governance/replay/bulk-execute", {"replay_ids": [1]}),
        ("POST", "/api/v1/governance/policies", {"name": "p", "policy_type": "drop", "action": "quarantine"}),
    ]:
        resp = client.request(method, path, headers=_json_headers("OPERATOR"), json=body)
        _assert_forbidden(resp)


def test_operator_display_settings_not_forbidden(client: TestClient) -> None:
    r = client.put(
        "/api/v1/admin/display-settings",
        headers=_json_headers("OPERATOR"),
        json={"default_timezone": "UTC"},
    )
    assert r.status_code != 403, r.text


def test_operator_runtime_control_not_forbidden(client: TestClient) -> None:
    for path in (
        "/api/v1/runtime/streams/99999/start",
        "/api/v1/runtime/streams/99999/stop",
        "/api/v1/runtime/streams/99999/run-once",
        "/api/v1/runtime/streams/99999/checkpoint/reset",
    ):
        r = client.post(path, headers=_bearer("OPERATOR"))
        assert r.status_code != 403, f"{path}: {r.text}"


# --- Administrator allow ---


def test_admin_workspace_and_restore_not_forbidden(client: TestClient, db_session: Session) -> None:
    connector = Connector(name="rbac-admin-conn", description=None, status="RUNNING")
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

    r = client.post(
        "/api/v1/streams/",
        headers=_json_headers("ADMINISTRATOR"),
        json={
            "name": "rbac-admin-stream",
            "connector_id": connector.id,
            "source_id": source.id,
            "polling_interval": 30,
            "enabled": True,
            "status": "STOPPED",
        },
    )
    assert r.status_code in {200, 201}, r.text

    apply = client.post(
        "/api/v1/backup/import/apply",
        headers=_json_headers("ADMINISTRATOR"),
        json={"bundle": {"version": 1, "connectors": []}, "mode": "additive", "preview_token": "x", "confirm": True},
    )
    # May fail validation, but must not be ROLE_FORBIDDEN
    assert apply.status_code != 403, apply.text


def test_admin_governance_policy_create_not_forbidden(client: TestClient) -> None:
    r = client.post(
        "/api/v1/governance/policies",
        headers=_json_headers("ADMINISTRATOR"),
        json={"name": "rbac-admin-policy", "policy_type": "drop", "action": "quarantine"},
    )
    assert r.status_code != 403, r.text


def test_viewer_backup_export_allowed(client: TestClient) -> None:
    r = client.get("/api/v1/backup/workspace/export", headers=_bearer("VIEWER"))
    assert r.status_code != 403, r.text
