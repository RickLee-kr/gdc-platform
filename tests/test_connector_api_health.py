"""Connector/API Health — GET /connectors/{id}/api-health (read-only)."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.credentials.models import CREDENTIAL_STATUS_EXPIRED, Credential
from app.database import get_db, utcnow
from app.logs.models import DeliveryLog
from app.main import app
from app.sources.models import Source
from tests.test_stream_runner_e2e import _seed_stream_runtime


@pytest.fixture
def api_health_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    # get_db_read_bounded is used by the health endpoint
    from app.database import get_db_read_bounded

    app.dependency_overrides[get_db_read_bounded] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_db_read_bounded, None)


def _set_auth_operational(db: Session, connector_id: int, *, status: str, error: str | None = None) -> None:
    source = (
        db.query(Source)
        .filter(Source.connector_id == connector_id)
        .order_by(Source.id.asc())
        .first()
    )
    assert source is not None
    cfg = dict(source.config_json or {})
    op = dict(cfg.get("operational") or {})
    op["last_auth_check_at"] = utcnow().isoformat()
    op["last_auth_check_status"] = status
    op["last_auth_error"] = error
    cfg["operational"] = op
    source.config_json = cfg
    db.add(source)
    db.commit()


def test_api_health_healthy_after_auth_success(api_health_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    connector_id = int(seeded["connector_id"])
    _set_auth_operational(db_session, connector_id, status="success")

    response = api_health_client.get(f"/api/v1/connectors/{connector_id}/api-health")
    assert response.status_code == 200
    body = response.json()
    assert body["connector_id"] == connector_id
    assert body["health"] == "HEALTHY"
    assert body["failure_kind"] == "none"
    assert body["problem"]
    assert body["cause"]
    assert body["recommended_action"]
    assert body["last_success_at"] is not None
    assert any(a["id"] == "test_connection" for a in body["actions"])


def test_api_health_authentication_failure(api_health_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    connector_id = int(seeded["connector_id"])
    _set_auth_operational(db_session, connector_id, status="failed", error="401 Unauthorized")

    response = api_health_client.get(f"/api/v1/connectors/{connector_id}/api-health")
    assert response.status_code == 200
    body = response.json()
    assert body["health"] == "UNHEALTHY"
    assert body["failure_kind"] == "authentication"
    assert "401" in body["problem"] or "Auth" in body["problem"]
    assert body["last_failure_at"] is not None
    assert body["recommended_action"]


def test_api_health_timeout_from_source_fetch(api_health_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    connector_id = int(seeded["connector_id"])
    stream_id = int(seeded["stream_id"])
    db_session.add(
        DeliveryLog(
            stream_id=stream_id,
            route_id=None,
            destination_id=None,
            stage="source_fetch_failed",
            level="ERROR",
            status="FAILED",
            message="Read timed out waiting for vendor API",
            payload_sample={},
            retry_count=0,
            http_status=None,
            error_code="SOURCE_FETCH_FAILED",
            created_at=utcnow(),
        )
    )
    db_session.commit()

    response = api_health_client.get(f"/api/v1/connectors/{connector_id}/api-health")
    assert response.status_code == 200
    body = response.json()
    assert body["health"] == "UNHEALTHY"
    assert body["failure_kind"] == "timeout"
    assert body["last_failure_at"] is not None
    assert body["source_fetch_failed_count"] >= 1
    assert any(s["stream_id"] == stream_id for s in body["affected_streams"])
    assert any(a["id"] == "open_troubleshooter" for a in body["actions"])


def test_api_health_connectivity_failure(api_health_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    connector_id = int(seeded["connector_id"])
    stream_id = int(seeded["stream_id"])
    db_session.add(
        DeliveryLog(
            stream_id=stream_id,
            route_id=None,
            destination_id=None,
            stage="source_fetch_failed",
            level="ERROR",
            status="FAILED",
            message="Connection refused by upstream host",
            payload_sample={},
            retry_count=0,
            http_status=None,
            error_code="SOURCE_FETCH_FAILED",
            created_at=utcnow(),
        )
    )
    db_session.commit()

    body = api_health_client.get(f"/api/v1/connectors/{connector_id}/api-health").json()
    assert body["failure_kind"] == "connectivity"
    assert body["health"] == "UNHEALTHY"


def test_api_health_rate_limit_warning(api_health_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    connector_id = int(seeded["connector_id"])
    stream_id = int(seeded["stream_id"])
    for _ in range(2):
        db_session.add(
            DeliveryLog(
                stream_id=stream_id,
                route_id=None,
                destination_id=None,
                stage="source_rate_limited",
                level="WARN",
                status="RATE_LIMITED",
                message="Vendor throttled source requests",
                payload_sample={},
                retry_count=0,
                http_status=429,
                error_code="SOURCE_RATE_LIMITED",
                created_at=utcnow(),
            )
        )
    db_session.commit()

    body = api_health_client.get(f"/api/v1/connectors/{connector_id}/api-health").json()
    assert body["failure_kind"] == "rate_limit"
    assert body["health"] == "WARNING"
    assert body["source_rate_limited_count"] >= 2


def test_api_health_http_api_failure(api_health_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    connector_id = int(seeded["connector_id"])
    stream_id = int(seeded["stream_id"])
    db_session.add(
        DeliveryLog(
            stream_id=stream_id,
            route_id=None,
            destination_id=None,
            stage="source_fetch_failed",
            level="ERROR",
            status="FAILED",
            message="Vendor returned server error",
            payload_sample={},
            retry_count=0,
            http_status=503,
            error_code="SOURCE_FETCH_FAILED",
            created_at=utcnow(),
        )
    )
    db_session.commit()

    body = api_health_client.get(f"/api/v1/connectors/{connector_id}/api-health").json()
    assert body["failure_kind"] == "http_api"
    assert body["health"] == "UNHEALTHY"


def test_api_health_read_only_no_side_effects(api_health_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    connector_id = int(seeded["connector_id"])
    source = (
        db_session.query(Source)
        .filter(Source.connector_id == connector_id)
        .order_by(Source.id.asc())
        .first()
    )
    assert source is not None
    before_cfg = dict(source.config_json or {})
    before_updated = source.updated_at if hasattr(source, "updated_at") else None
    log_count_before = db_session.query(DeliveryLog).count()

    response = api_health_client.get(f"/api/v1/connectors/{connector_id}/api-health")
    assert response.status_code == 200

    db_session.expire_all()
    source_after = (
        db_session.query(Source)
        .filter(Source.connector_id == connector_id)
        .order_by(Source.id.asc())
        .first()
    )
    assert source_after is not None
    assert dict(source_after.config_json or {}) == before_cfg
    if before_updated is not None and hasattr(source_after, "updated_at"):
        assert source_after.updated_at == before_updated
    assert db_session.query(DeliveryLog).count() == log_count_before


def test_api_health_credential_expiration(api_health_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    connector_id = int(seeded["connector_id"])
    db_session.add(
        Credential(
            connector_id=connector_id,
            name="expired-cred",
            auth_type="OAUTH2_CLIENT_CREDENTIALS",
            auth_json={"auth_type": "oauth2_client_credentials", "expires_at": "2020-01-01T00:00:00+00:00"},
            status=CREDENTIAL_STATUS_EXPIRED,
        )
    )
    db_session.commit()

    body = api_health_client.get(f"/api/v1/connectors/{connector_id}/api-health").json()
    assert body["health"] == "UNHEALTHY"
    assert body["failure_kind"] == "credential_expiration"
    assert body["credential_status"] == CREDENTIAL_STATUS_EXPIRED


def test_api_health_not_found(api_health_client: TestClient) -> None:
    response = api_health_client.get("/api/v1/connectors/999999/api-health")
    assert response.status_code == 404
