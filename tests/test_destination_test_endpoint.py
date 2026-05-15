from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db
from app.destinations.models import Destination
from app.main import app


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_destination_test_endpoint_calls_service(client: TestClient, db_session: Session) -> None:
    row = Destination(
        name="udp-test",
        destination_type="SYSLOG_UDP",
        config_json={"host": "127.0.0.1", "port": 5514},
        rate_limit_json={},
        enabled=True,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)

    fake: dict[str, Any] = {
        "success": True,
        "latency_ms": 1.23,
        "message": "UDP send attempted; receiver acknowledgement is not available.",
        "detail": {"protocol": "udp"},
        "tested_at": "2026-05-09T12:00:00+00:00",
    }

    with patch("app.destinations.router.run_destination_connectivity_test", return_value=fake):
        res = client.post(f"/api/v1/destinations/{row.id}/test")

    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["latency_ms"] == 1.23


def test_destination_test_tcp_webhook_mocked(client: TestClient, db_session: Session) -> None:
    tcp = Destination(
        name="tcp-test",
        destination_type="SYSLOG_TCP",
        config_json={"host": "127.0.0.1", "port": 5514},
        rate_limit_json={},
        enabled=True,
    )
    hook = Destination(
        name="hook-test",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://example.com/hook"},
        rate_limit_json={},
        enabled=True,
    )
    db_session.add_all([tcp, hook])
    db_session.commit()
    db_session.refresh(tcp)
    db_session.refresh(hook)

    with patch(
        "app.destinations.router.run_destination_connectivity_test",
        return_value={"success": True, "latency_ms": 2, "message": "ok", "detail": None, "tested_at": "2026-05-09T12:00:00Z"},
    ):
        r1 = client.post(f"/api/v1/destinations/{tcp.id}/test")
        r2 = client.post(f"/api/v1/destinations/{hook.id}/test")
    assert r1.status_code == 200
    assert r2.status_code == 200
