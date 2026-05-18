from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db
from app.main import app
from app.platform_admin.models import PlatformNetworkConfig
from app.platform_admin.network_config import (
    REVERSE_PROXY_RECREATE_COMMAND,
    REVERSE_PROXY_RECREATE_COMMAND_TEXT,
    NetworkPortConfig,
    NetworkPortValidationError,
    ReverseProxyApplyResult,
    apply_reverse_proxy_recreate,
    update_platform_env_ports,
    validate_network_ports,
)
from app.platform_admin.repository import get_network_config_row

ROOT = Path(__file__).resolve().parents[1]
RESTART_COMMAND = "docker compose -f docker-compose.platform.yml up -d --force-recreate reverse-proxy"


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def isolate_platform_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    env_path = tmp_path / ".env"
    env_path.write_text("GDC_HTTP_PORT=18080\nGDC_HTTPS_PORT=18443\n", encoding="utf-8")
    monkeypatch.setattr("app.platform_admin.network_config.PLATFORM_ENV_PATH", env_path)
    monkeypatch.setattr("app.config.settings.GDC_HTTP_PORT", 18080, raising=False)
    monkeypatch.setattr("app.config.settings.GDC_HTTPS_PORT", 18443, raising=False)


def test_validate_network_ports_accepts_defaults() -> None:
    cfg = validate_network_ports("18080", "18443")
    assert cfg.http_port == 18080
    assert cfg.https_port == 18443


@pytest.mark.parametrize(
    ("http_port", "https_port", "message"),
    [
        ("abc", "18443", "numeric TCP port"),
        ("0", "18443", "between 1 and 65535"),
        ("18080", "18080", "cannot be identical"),
        ("8000", "18443", "reserved platform service port"),
    ],
)
def test_validate_network_ports_rejects_invalid_values(http_port: str, https_port: str, message: str) -> None:
    with pytest.raises(NetworkPortValidationError, match=message):
        validate_network_ports(http_port, https_port)


def test_compose_uses_required_reverse_proxy_port_variables() -> None:
    text = (ROOT / "docker-compose.platform.yml").read_text(encoding="utf-8")
    assert '"${GDC_HTTP_PORT:-18080}:80"' in text
    assert '"${GDC_HTTPS_PORT:-18443}:443"' in text
    assert "GDC_ENTRY_HTTP_PORT" not in text
    assert "GDC_ENTRY_HTTPS_PORT" not in text


def test_network_settings_row_defaults(db_session: Session) -> None:
    row = get_network_config_row(db_session)
    assert row.id == 1
    assert isinstance(row, PlatformNetworkConfig)
    assert row.http_port == 18080
    assert row.https_port == 18443


def test_network_settings_api_read_and_update(client: TestClient, db_session: Session) -> None:
    get_network_config_row(db_session)
    db_session.commit()

    r = client.get("/api/v1/admin/network-settings")
    assert r.status_code == 200
    assert r.json()["restart_required"] is False
    assert r.json()["env_example"] == {"GDC_HTTP_PORT": "18080", "GDC_HTTPS_PORT": "18443"}
    assert r.json()["restart_command"] == RESTART_COMMAND

    r2 = client.put("/api/v1/admin/network-settings", json={"http_port": 19080, "https_port": 19443})
    assert r2.status_code == 200
    body = r2.json()
    assert body["http_port"] == 19080
    assert body["https_port"] == 19443
    assert body["restart_required"] is True
    assert body["env_example"] == {"GDC_HTTP_PORT": "19080", "GDC_HTTPS_PORT": "19443"}
    assert body["restart_command"] == RESTART_COMMAND


def test_update_platform_env_ports_preserves_unrelated_values_and_creates_backup(tmp_path: Path) -> None:
    env_path = tmp_path / ".env"
    env_path.write_text(
        "DATABASE_URL=postgresql://example\n"
        "GDC_HTTP_PORT=18080\n"
        "SECRET_KEY=keep-me\n"
        "GDC_HTTPS_PORT=18443\n",
        encoding="utf-8",
    )

    result = update_platform_env_ports(NetworkPortConfig(http_port=19080, https_port=19443), env_path=env_path)

    assert result.env_path == env_path
    assert result.backup_path.is_file()
    assert result.backup_path.read_text(encoding="utf-8") == (
        "DATABASE_URL=postgresql://example\n"
        "GDC_HTTP_PORT=18080\n"
        "SECRET_KEY=keep-me\n"
        "GDC_HTTPS_PORT=18443\n"
    )
    updated = env_path.read_text(encoding="utf-8")
    assert "DATABASE_URL=postgresql://example\n" in updated
    assert "SECRET_KEY=keep-me\n" in updated
    assert "GDC_HTTP_PORT=19080\n" in updated
    assert "GDC_HTTPS_PORT=19443\n" in updated


def test_network_settings_api_updates_platform_env(
    client: TestClient, db_session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env_path = tmp_path / ".env"
    env_path.write_text("KEEP_THIS=value\nGDC_HTTP_PORT=18080\nGDC_HTTPS_PORT=18443\n", encoding="utf-8")
    monkeypatch.setattr("app.platform_admin.network_config.PLATFORM_ENV_PATH", env_path)

    get_network_config_row(db_session)
    db_session.commit()
    r = client.put("/api/v1/admin/network-settings", json={"http_port": 19080, "https_port": 19443})

    assert r.status_code == 200
    body = r.json()
    assert body["restart_required"] is True
    assert body["env_example"] == {"GDC_HTTP_PORT": "19080", "GDC_HTTPS_PORT": "19443"}
    text = env_path.read_text(encoding="utf-8")
    assert "KEEP_THIS=value\n" in text
    assert "GDC_HTTP_PORT=19080\n" in text
    assert "GDC_HTTPS_PORT=19443\n" in text
    backups = list(tmp_path.glob(".env.bak-*"))
    assert len(backups) == 1
    assert "GDC_HTTP_PORT=18080\n" in backups[0].read_text(encoding="utf-8")


def test_network_settings_api_rejects_duplicate_ports(client: TestClient, db_session: Session) -> None:
    get_network_config_row(db_session)
    db_session.commit()

    r = client.put("/api/v1/admin/network-settings", json={"http_port": 19080, "https_port": 19080})
    assert r.status_code == 422
    assert r.json()["detail"]["error_code"] == "NETWORK_PORT_INVALID"


def test_apply_reverse_proxy_recreate_uses_fixed_command_only(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    calls: list[dict[str, Any]] = []

    def fake_run(args: list[str], **kwargs: Any) -> SimpleNamespace:
        calls.append({"args": args, "kwargs": kwargs})
        return SimpleNamespace(returncode=0, stdout="ok\n", stderr="")

    monkeypatch.setattr("app.platform_admin.network_config.subprocess.run", fake_run)

    result = apply_reverse_proxy_recreate(cwd=tmp_path, http_port=19080, https_port=19443)

    assert result.success is True
    assert result.command == REVERSE_PROXY_RECREATE_COMMAND_TEXT
    assert len(calls) == 1
    assert calls[0]["args"] == list(REVERSE_PROXY_RECREATE_COMMAND)
    assert calls[0]["kwargs"]["cwd"] == str(tmp_path)
    assert calls[0]["kwargs"]["capture_output"] is True
    assert calls[0]["kwargs"]["text"] is True
    assert calls[0]["kwargs"]["check"] is False
    assert calls[0]["kwargs"]["timeout"] == 120
    assert calls[0]["kwargs"]["env"]["GDC_HTTP_PORT"] == "19080"
    assert calls[0]["kwargs"]["env"]["GDC_HTTPS_PORT"] == "19443"
    assert "shell" not in calls[0]["kwargs"]


def test_network_settings_apply_endpoint_is_admin_only(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.config.settings.AUTH_DEV_HEADER_TRUST", True, raising=False)
    monkeypatch.setattr(
        "app.platform_admin.router.apply_reverse_proxy_recreate",
        lambda **_kwargs: ReverseProxyApplyResult(
            success=True,
            command=RESTART_COMMAND,
            stdout="recreated\n",
            stderr="",
            exit_code=0,
        ),
    )

    forbidden = client.post("/api/v1/admin/network-settings/apply", headers={"X-GDC-Role": "OPERATOR"})
    assert forbidden.status_code == 403

    ok = client.post("/api/v1/admin/network-settings/apply", headers={"X-GDC-Role": "ADMINISTRATOR"})
    assert ok.status_code == 200
    body = ok.json()
    assert body["success"] is True
    assert body["command"] == RESTART_COMMAND
    assert body["stdout"] == "recreated\n"
    assert body["exit_code"] == 0


def test_network_settings_api_rejects_reserved_port(client: TestClient, db_session: Session) -> None:
    get_network_config_row(db_session)
    db_session.commit()

    r = client.put("/api/v1/admin/network-settings", json={"http_port": 8000, "https_port": 19443})
    assert r.status_code == 422
    assert r.json()["detail"]["error_code"] == "NETWORK_PORT_INVALID"
