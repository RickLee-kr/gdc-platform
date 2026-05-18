from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db
from app.main import app
from app.platform_admin.models import PlatformNetworkConfig
from app.platform_admin.network_config import NetworkPortValidationError, validate_network_ports
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


def test_network_settings_api_rejects_duplicate_ports(client: TestClient, db_session: Session) -> None:
    get_network_config_row(db_session)
    db_session.commit()

    r = client.put("/api/v1/admin/network-settings", json={"http_port": 19080, "https_port": 19080})
    assert r.status_code == 422
    assert r.json()["detail"]["error_code"] == "NETWORK_PORT_INVALID"


def test_network_settings_api_rejects_reserved_port(client: TestClient, db_session: Session) -> None:
    get_network_config_row(db_session)
    db_session.commit()

    r = client.put("/api/v1/admin/network-settings", json={"http_port": 8000, "https_port": 19443})
    assert r.status_code == 422
    assert r.json()["detail"]["error_code"] == "NETWORK_PORT_INVALID"
