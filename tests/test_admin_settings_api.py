from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.security import get_password_hash, verify_password
from app.database import get_db
from app.main import app
from app.platform_admin.models import PlatformHttpsConfig, PlatformUser
from app.platform_admin.repository import get_https_config_row


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def tls_paths(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> tuple[str, str]:
    cert = tmp_path / "tls.crt"
    key = tmp_path / "tls.key"
    monkeypatch.setattr("app.config.settings.GDC_TLS_CERT_PATH", str(cert), raising=False)
    monkeypatch.setattr("app.config.settings.GDC_TLS_KEY_PATH", str(key), raising=False)
    return str(cert), str(key)


def test_https_get_returns_row(client: TestClient, db_session: Session) -> None:
    get_https_config_row(db_session)
    db_session.commit()
    r = client.get("/api/v1/admin/https-settings")
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is False
    assert body["certificate_ip_addresses"] == []
    assert "current_access_url" in body


def test_https_put_validation_requires_san_when_enabled(client: TestClient, db_session: Session) -> None:
    get_https_config_row(db_session)
    db_session.commit()
    r = client.put(
        "/api/v1/admin/https-settings",
        json={
            "enabled": True,
            "certificate_ip_addresses": [],
            "certificate_dns_names": [],
            "redirect_http_to_https": False,
            "certificate_valid_days": 365,
        },
    )
    assert r.status_code == 422
    assert r.json()["detail"]["error_code"] == "HTTPS_SAN_REQUIRED"


def test_https_put_invalid_ip(client: TestClient, db_session: Session) -> None:
    get_https_config_row(db_session)
    db_session.commit()
    r = client.put(
        "/api/v1/admin/https-settings",
        json={
            "enabled": True,
            "certificate_ip_addresses": ["not-an-ip"],
            "certificate_dns_names": [],
            "redirect_http_to_https": False,
            "certificate_valid_days": 365,
        },
    )
    assert r.status_code == 422
    assert r.json()["detail"]["error_code"] == "HTTPS_SAN_INVALID"


def test_https_save_generates_cert(client: TestClient, db_session: Session, tls_paths: tuple[str, str]) -> None:
    get_https_config_row(db_session)
    db_session.commit()
    cert_path, _key_path = tls_paths
    r = client.put(
        "/api/v1/admin/https-settings",
        json={
            "enabled": True,
            "certificate_ip_addresses": ["127.0.0.1"],
            "certificate_dns_names": ["gdc.local"],
            "redirect_http_to_https": True,
            "certificate_valid_days": 90,
            "regenerate_certificate": True,
        },
    )
    assert r.status_code == 200
    assert r.json()["restart_required"] is True
    assert __import__("pathlib").Path(cert_path).is_file()
    row = get_https_config_row(db_session)
    assert row.enabled is True
    assert row.redirect_http_to_https is True
    assert row.cert_not_after is not None


def test_https_skip_regenerate_rejects_invalid_pem(
    client: TestClient, db_session: Session, tls_paths: tuple[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from pathlib import Path

    _conf = str(Path(tls_paths[0]).parent / "nginx.conf")
    monkeypatch.setattr("app.platform_admin.router.settings.GDC_NGINX_CONF_PATH", _conf, raising=False)
    monkeypatch.setattr("app.platform_admin.nginx_runtime.settings.GDC_NGINX_CONF_PATH", _conf, raising=False)
    monkeypatch.setattr("app.platform_admin.router.settings.GDC_PROXY_RELOAD_URL", "", raising=False)
    monkeypatch.setattr("app.platform_admin.nginx_runtime.settings.GDC_PROXY_RELOAD_URL", "", raising=False)
    get_https_config_row(db_session)
    db_session.commit()
    cert_path, _key_path = tls_paths
    r1 = client.put(
        "/api/v1/admin/https-settings",
        json={
            "enabled": True,
            "certificate_ip_addresses": ["127.0.0.1"],
            "certificate_dns_names": [],
            "redirect_http_to_https": False,
            "certificate_valid_days": 90,
            "regenerate_certificate": True,
        },
    )
    assert r1.status_code == 200
    Path(cert_path).write_bytes(b"not-a-pem")
    r2 = client.put(
        "/api/v1/admin/https-settings",
        json={
            "enabled": True,
            "certificate_ip_addresses": ["127.0.0.1"],
            "certificate_dns_names": [],
            "redirect_http_to_https": False,
            "certificate_valid_days": 90,
            "regenerate_certificate": False,
        },
    )
    assert r2.status_code == 422
    assert r2.json()["detail"]["error_code"] == "HTTPS_CERT_INVALID"


def test_user_crud_and_last_admin_guard(client: TestClient, db_session: Session) -> None:
    u = PlatformUser(
        username="admin1",
        password_hash=get_password_hash("oldpass-12"),
        role="ADMINISTRATOR",
        status="ACTIVE",
    )
    db_session.add(u)
    db_session.commit()

    r = client.get("/api/v1/admin/users")
    assert r.status_code == 200
    assert len(r.json()) == 1

    r2 = client.post(
        "/api/v1/admin/users",
        json={"username": "op1", "password": "longpass-1", "role": "OPERATOR"},
    )
    assert r2.status_code == 201

    uid = r2.json()["id"]
    r3 = client.patch(f"/api/v1/admin/users/{uid}", json={"role": "VIEWER"})
    assert r3.status_code == 200
    assert r3.json()["role"] == "VIEWER"

    r_bad = client.patch(f"/api/v1/admin/users/{u.id}", json={"role": "OPERATOR"})
    assert r_bad.status_code == 422
    assert r_bad.json()["detail"]["error_code"] == "USER_LAST_ADMIN"

    r_del = client.delete(f"/api/v1/admin/users/{uid}")
    assert r_del.status_code == 204

    r_del_admin = client.delete(f"/api/v1/admin/users/{u.id}")
    assert r_del_admin.status_code == 400


def test_password_change(client: TestClient, db_session: Session) -> None:
    u = PlatformUser(
        username="pwuser",
        password_hash=get_password_hash("current-12"),
        role="OPERATOR",
        status="ACTIVE",
    )
    db_session.add(u)
    db_session.commit()

    r = client.post(
        "/api/v1/admin/password",
        json={
            "username": "pwuser",
            "current_password": "current-12",
            "new_password": "newpass-12",
            "confirm_password": "newpass-12",
        },
    )
    assert r.status_code == 204
    db_session.expire_all()
    row = db_session.get(PlatformUser, u.id)
    assert row is not None
    assert verify_password("newpass-12", row.password_hash)


def test_password_change_mismatch_validation(client: TestClient) -> None:
    r = client.post(
        "/api/v1/admin/password",
        json={
            "username": "x",
            "current_password": "a",
            "new_password": "newpass-12",
            "confirm_password": "other-12",
        },
    )
    assert r.status_code == 422


def test_system_info(client: TestClient, db_session: Session) -> None:
    r = client.get("/api/v1/admin/system")
    assert r.status_code == 200
    body = r.json()
    assert body["database_reachable"] is True
    assert "python_version" in body


def test_https_config_row_exists_after_schema_reset(db_session: Session) -> None:
    row = get_https_config_row(db_session)
    assert row.id == 1
    assert isinstance(row, PlatformHttpsConfig)
