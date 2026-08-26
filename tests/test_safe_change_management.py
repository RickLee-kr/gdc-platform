"""P0 Safe Change Management — preview/apply API tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db, get_db_read_bounded
from app.main import app
from app.platform_admin.models import PlatformAuditEvent, PlatformConfigVersion
from app.streams.models import Stream
from tests.test_stream_runner_e2e import _seed_stream_runtime


@pytest.fixture
def safe_change_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_db_read_bounded] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_db_read_bounded, None)


def _preview(client: TestClient, *, entity_type: str, entity_id: int, proposed: dict[str, Any], **extra: Any) -> Any:
    body = {"entity_type": entity_type, "entity_id": entity_id, "proposed": proposed, **extra}
    return client.post("/api/v1/runtime/safe-change/preview", json=body)


def _apply(client: TestClient, *, entity_type: str, entity_id: int, proposed: dict[str, Any], **extra: Any) -> Any:
    body = {"entity_type": entity_type, "entity_id": entity_id, "proposed": proposed, **extra}
    return client.post("/api/v1/runtime/safe-change/apply", json=body)


def test_safe_change_preview_stream_changes(safe_change_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    stream = db_session.query(Stream).filter(Stream.id == stream_id).first()
    assert stream is not None
    stream.status = "STOPPED"
    db_session.commit()

    response = _preview(
        safe_change_client,
        entity_type="STREAM_CONFIG",
        entity_id=stream_id,
        proposed={"polling_interval": 120, "name": stream.name},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["preview_only"] is True
    assert body["has_changes"] is True
    assert body["can_apply"] is True
    assert any(c["path"] == "polling_interval" for c in body["changed_fields"])
    assert body["affected"]["streams"]
    assert body["affected"]["routes"]
    assert body["blocking_issues"] == []


def test_safe_change_no_change_preview(safe_change_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    stream = db_session.query(Stream).filter(Stream.id == stream_id).first()
    assert stream is not None

    response = _preview(
        safe_change_client,
        entity_type="STREAM_CONFIG",
        entity_id=stream_id,
        proposed={
            "name": stream.name,
            "enabled": stream.enabled,
            "polling_interval": stream.polling_interval,
            "config_json": stream.config_json,
            "rate_limit_json": stream.rate_limit_json,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["has_changes"] is False
    assert body["can_apply"] is True
    assert body["changed_fields"] == []


def test_safe_change_warning_when_stream_running(safe_change_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    # seed defaults to RUNNING
    response = _preview(
        safe_change_client,
        entity_type="STREAM_CONFIG",
        entity_id=stream_id,
        proposed={"polling_interval": 999},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["can_apply"] is True
    assert any(w["code"] == "STREAM_RUNNING" for w in body["warnings"])
    assert any(a["id"] == "canary" for a in body["recommended_actions"])


def test_safe_change_blocking_destination_while_streams_running(
    safe_change_client: TestClient, db_session: Session
) -> None:
    seeded = _seed_stream_runtime(db_session)
    destination_id = int(seeded["destination_ids"][0])

    response = _preview(
        safe_change_client,
        entity_type="DESTINATION_CONFIG",
        entity_id=destination_id,
        proposed={"config_json": {"url": "https://new.example.com/hook", "host": "new.example.com", "port": 443}},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["can_apply"] is False
    assert any(b["code"] == "CONNECTED_STREAMS_RUNNING" for b in body["blocking_issues"])
    assert any(w["code"] == "AUTH_OR_ENDPOINT_CHANGE" for w in body["warnings"]) or any(
        c["path"].endswith("url") or "host" in c["path"] for c in body["changed_fields"]
    )


def test_safe_change_blocking_invalid_destination_config(
    safe_change_client: TestClient, db_session: Session
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    stream = db_session.query(Stream).filter(Stream.id == stream_id).first()
    assert stream is not None
    stream.status = "STOPPED"
    db_session.commit()
    destination_id = int(seeded["destination_ids"][0])

    response = _preview(
        safe_change_client,
        entity_type="DESTINATION_CONFIG",
        entity_id=destination_id,
        proposed={
            "destination_type": "SYSLOG_TLS",
            "config_json": {"port": 6514},  # missing host — invalid
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["can_apply"] is False
    assert any(b["code"] == "INVALID_CONFIG" for b in body["blocking_issues"])


def test_safe_change_preview_has_no_persistence_side_effect(
    safe_change_client: TestClient, db_session: Session
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    stream = db_session.query(Stream).filter(Stream.id == stream_id).first()
    assert stream is not None
    before_name = stream.name
    before_interval = stream.polling_interval
    before_versions = db_session.query(PlatformConfigVersion).count()
    before_audits = db_session.query(PlatformAuditEvent).count()

    response = _preview(
        safe_change_client,
        entity_type="STREAM_CONFIG",
        entity_id=stream_id,
        proposed={"polling_interval": before_interval + 15, "name": f"{before_name}-preview"},
    )
    assert response.status_code == 200

    db_session.expire_all()
    stream = db_session.query(Stream).filter(Stream.id == stream_id).first()
    assert stream is not None
    assert stream.name == before_name
    assert stream.polling_interval == before_interval
    assert db_session.query(PlatformConfigVersion).count() == before_versions
    assert db_session.query(PlatformAuditEvent).count() == before_audits


def test_safe_change_apply_uses_existing_persist_path(
    safe_change_client: TestClient, db_session: Session
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    stream = db_session.query(Stream).filter(Stream.id == stream_id).first()
    assert stream is not None
    stream.status = "STOPPED"
    db_session.commit()
    db_session.refresh(stream)

    before_versions = db_session.query(PlatformConfigVersion).count()
    before_audits = db_session.query(PlatformAuditEvent).count()
    original_interval = int(stream.polling_interval)

    response = _apply(
        safe_change_client,
        entity_type="STREAM_CONFIG",
        entity_id=stream_id,
        proposed={"polling_interval": original_interval + 30},
        base_updated_at=stream.updated_at.isoformat(),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["applied"] is True
    assert body["no_op"] is False
    assert body["config_version"] is not None

    db_session.expire_all()
    stream = db_session.query(Stream).filter(Stream.id == stream_id).first()
    assert stream is not None
    assert int(stream.polling_interval) == original_interval + 30
    assert db_session.query(PlatformConfigVersion).count() == before_versions + 1
    assert db_session.query(PlatformAuditEvent).count() >= before_audits + 1
    latest_audit = (
        db_session.query(PlatformAuditEvent).order_by(PlatformAuditEvent.id.desc()).first()
    )
    assert latest_audit is not None
    assert latest_audit.action == "STREAM_UPDATED"


def test_safe_change_apply_no_op(safe_change_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    stream = db_session.query(Stream).filter(Stream.id == stream_id).first()
    assert stream is not None
    before_versions = db_session.query(PlatformConfigVersion).count()

    response = _apply(
        safe_change_client,
        entity_type="STREAM_CONFIG",
        entity_id=stream_id,
        proposed={
            "name": stream.name,
            "enabled": stream.enabled,
            "polling_interval": stream.polling_interval,
            "config_json": stream.config_json,
            "rate_limit_json": stream.rate_limit_json,
        },
        base_updated_at=stream.updated_at.isoformat(),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["applied"] is False
    assert body["no_op"] is True
    assert db_session.query(PlatformConfigVersion).count() == before_versions


def test_safe_change_stale_version_conflict(safe_change_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    stream = db_session.query(Stream).filter(Stream.id == stream_id).first()
    assert stream is not None
    stream.status = "STOPPED"
    db_session.commit()
    db_session.refresh(stream)

    stale = (_utc(stream.updated_at) - timedelta(hours=1)).isoformat()
    response = _preview(
        safe_change_client,
        entity_type="STREAM_CONFIG",
        entity_id=stream_id,
        proposed={"polling_interval": 42},
        base_updated_at=stale,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["can_apply"] is False
    assert body["stale_base"] is True
    assert any(b["code"] == "STALE_CONFIGURATION" for b in body["blocking_issues"])

    apply_resp = _apply(
        safe_change_client,
        entity_type="STREAM_CONFIG",
        entity_id=stream_id,
        proposed={"polling_interval": 42},
        base_updated_at=stale,
    )
    assert apply_resp.status_code == 409
    assert apply_resp.json()["detail"]["error_code"] == "STALE_CONFIGURATION"


def test_safe_change_put_stale_guard(safe_change_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    stream = db_session.query(Stream).filter(Stream.id == stream_id).first()
    assert stream is not None
    stale = (_utc(stream.updated_at) - timedelta(days=1)).isoformat()
    response = safe_change_client.put(
        f"/api/v1/streams/{stream_id}",
        json={"polling_interval": 77, "base_updated_at": stale},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["error_code"] == "STALE_CONFIGURATION"


def test_safe_change_route_affected_entities(safe_change_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    route_id = int(seeded["route_ids"][0])
    stream = db_session.query(Stream).filter(Stream.id == int(seeded["stream_id"])).first()
    assert stream is not None
    stream.status = "STOPPED"
    db_session.commit()

    response = _preview(
        safe_change_client,
        entity_type="ROUTE_CONFIG",
        entity_id=route_id,
        proposed={"enabled": False},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["has_changes"] is True
    assert body["affected"]["streams"]
    assert body["affected"]["destinations"]
    assert any(w["code"] == "ENABLEMENT_CHANGE" for w in body["warnings"])


def test_safe_change_apply_blocked_destination(safe_change_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    destination_id = int(seeded["destination_ids"][0])
    response = _apply(
        safe_change_client,
        entity_type="DESTINATION_CONFIG",
        entity_id=destination_id,
        proposed={"name": "should-not-apply"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["error_code"] == "CONNECTED_STREAMS_RUNNING"


def _utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt
