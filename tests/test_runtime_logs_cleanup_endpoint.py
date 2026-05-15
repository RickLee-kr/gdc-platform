"""Runtime delivery_logs cleanup API — retention by age (dry-run or delete)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.database import get_db
from app.destinations.models import Destination
from app.logs.models import DeliveryLog
from app.main import app
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream

UTC = timezone.utc


def _seed_stream(db: Session) -> dict[str, int]:
    connector = Connector(name="cleanup-connector", description=None, status="RUNNING")
    db.add(connector)
    db.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={"k": "v"},
        auth_json={},
        enabled=True,
    )
    db.add(source)
    db.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="cleanup-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db.add(stream)
    db.flush()
    dest = Destination(
        name="cleanup-d",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://x.example/h"},
        rate_limit_json={},
        enabled=True,
    )
    db.add(dest)
    db.flush()
    route = Route(
        stream_id=stream.id,
        destination_id=dest.id,
        enabled=True,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    db.add(route)
    db.add(Checkpoint(stream_id=stream.id, checkpoint_type="CUSTOM_FIELD", checkpoint_value_json={"c": 1}))
    db.commit()
    db.refresh(stream)
    db.refresh(route)
    db.refresh(source)
    db.refresh(dest)
    return {
        "connector_id": connector.id,
        "stream_id": stream.id,
        "route_id": route.id,
        "dest_id": dest.id,
        "source_id": source.id,
        "stream_status": stream.status,
        "route_enabled": route.enabled,
        "source_cfg": dict(source.config_json or {}),
        "dest_name": dest.name,
    }


def _log(
    db: Session,
    *,
    connector_id: int,
    stream_id: int,
    route_id: int,
    destination_id: int,
    created_at: datetime,
    payload_sample: dict[str, Any] | None = None,
) -> None:
    db.add(
        DeliveryLog(
            connector_id=connector_id,
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
            stage="run_complete",
            level="INFO",
            status="OK",
            message="m",
            payload_sample=payload_sample or {"secret": "z"},
            retry_count=0,
            http_status=None,
            latency_ms=None,
            error_code=None,
            created_at=created_at,
        )
    )


@pytest.fixture
def cleanup_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_cleanup_dry_run_default_true(cleanup_client: TestClient, db_session: Session) -> None:
    h = _seed_stream(db_session)
    now = datetime.now(UTC)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_id"],
        destination_id=h["dest_id"],
        created_at=now - timedelta(days=60),
    )
    db_session.commit()

    r = cleanup_client.post("/api/v1/runtime/logs/cleanup", json={"older_than_days": 30})
    assert r.status_code == 200
    body = r.json()
    assert body["dry_run"] is True
    assert body["matched_count"] == 1
    assert body["deleted_count"] == 0


def test_cleanup_dry_run_no_delete(cleanup_client: TestClient, db_session: Session) -> None:
    h = _seed_stream(db_session)
    now = datetime.now(UTC)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_id"],
        destination_id=h["dest_id"],
        created_at=now - timedelta(days=90),
    )
    db_session.commit()
    before = db_session.query(DeliveryLog).count()

    r = cleanup_client.post(
        "/api/v1/runtime/logs/cleanup",
        json={"older_than_days": 30, "dry_run": True},
    )
    assert r.status_code == 200
    assert db_session.query(DeliveryLog).count() == before


def test_cleanup_dry_run_no_commit(
    monkeypatch: pytest.MonkeyPatch,
    cleanup_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream(db_session)
    now = datetime.now(UTC)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_id"],
        destination_id=h["dest_id"],
        created_at=now - timedelta(days=40),
    )
    db_session.commit()

    commits = {"n": 0}
    real_commit = Session.commit

    def _count_commit(self: Session, *args: Any, **kwargs: Any) -> None:
        commits["n"] += 1
        return real_commit(self, *args, **kwargs)

    monkeypatch.setattr(Session, "commit", _count_commit)

    assert (
        cleanup_client.post(
            "/api/v1/runtime/logs/cleanup",
            json={"older_than_days": 30, "dry_run": True},
        ).status_code
        == 200
    )
    assert commits["n"] == 0


def test_cleanup_execute_deletes_old_only(cleanup_client: TestClient, db_session: Session) -> None:
    h = _seed_stream(db_session)
    now = datetime.now(UTC)
    old_ts = now - timedelta(days=60)
    new_ts = now - timedelta(days=2)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_id"],
        destination_id=h["dest_id"],
        created_at=old_ts,
        payload_sample={"old": True},
    )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_id"],
        destination_id=h["dest_id"],
        created_at=new_ts,
        payload_sample={"new": True},
    )
    db_session.commit()

    r = cleanup_client.post(
        "/api/v1/runtime/logs/cleanup",
        json={"older_than_days": 30, "dry_run": False},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["matched_count"] == 1
    assert body["deleted_count"] == 1

    assert db_session.query(DeliveryLog).count() == 1


def test_cleanup_execute_commit_once(
    monkeypatch: pytest.MonkeyPatch,
    cleanup_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream(db_session)
    now = datetime.now(UTC)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_id"],
        destination_id=h["dest_id"],
        created_at=now - timedelta(days=50),
    )
    db_session.commit()

    commits = {"n": 0}
    real_commit = Session.commit

    def _count_commit(self: Session, *args: Any, **kwargs: Any) -> None:
        commits["n"] += 1
        return real_commit(self, *args, **kwargs)

    monkeypatch.setattr(Session, "commit", _count_commit)

    assert (
        cleanup_client.post(
            "/api/v1/runtime/logs/cleanup",
            json={"older_than_days": 30, "dry_run": False},
        ).status_code
        == 200
    )
    assert commits["n"] == 1


def test_cleanup_checkpoint_unchanged(cleanup_client: TestClient, db_session: Session) -> None:
    h = _seed_stream(db_session)
    cp = db_session.query(Checkpoint).filter(Checkpoint.stream_id == h["stream_id"]).one()
    before_val = dict(cp.checkpoint_value_json or {})
    now = datetime.now(UTC)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_id"],
        destination_id=h["dest_id"],
        created_at=now - timedelta(days=100),
    )
    db_session.commit()

    assert (
        cleanup_client.post(
            "/api/v1/runtime/logs/cleanup",
            json={"older_than_days": 30, "dry_run": False},
        ).status_code
        == 200
    )

    db_session.expire_all()
    cp2 = db_session.query(Checkpoint).filter(Checkpoint.stream_id == h["stream_id"]).one()
    assert dict(cp2.checkpoint_value_json or {}) == before_val


def test_cleanup_stream_route_source_destination_unchanged(
    cleanup_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream(db_session)
    now = datetime.now(UTC)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_id"],
        destination_id=h["dest_id"],
        created_at=now - timedelta(days=50),
    )
    db_session.commit()

    assert (
        cleanup_client.post(
            "/api/v1/runtime/logs/cleanup",
            json={"older_than_days": 30, "dry_run": False},
        ).status_code
        == 200
    )

    db_session.expire_all()
    stream = db_session.query(Stream).filter(Stream.id == h["stream_id"]).one()
    route = db_session.query(Route).filter(Route.id == h["route_id"]).one()
    src = db_session.query(Source).filter(Source.id == h["source_id"]).one()
    dest = db_session.query(Destination).filter(Destination.id == h["dest_id"]).one()
    assert stream.status == h["stream_status"]
    assert bool(route.enabled) == h["route_enabled"]
    assert dict(src.config_json or {}) == h["source_cfg"]
    assert dest.name == h["dest_name"]


def test_cleanup_response_no_payload_sample(cleanup_client: TestClient, db_session: Session) -> None:
    h = _seed_stream(db_session)
    now = datetime.now(UTC)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_id"],
        destination_id=h["dest_id"],
        created_at=now - timedelta(days=40),
    )
    db_session.commit()

    raw = cleanup_client.post(
        "/api/v1/runtime/logs/cleanup",
        json={"older_than_days": 30, "dry_run": True},
    ).text
    assert "payload_sample" not in raw
    assert "secret" not in raw


def test_cleanup_older_than_days_validation(cleanup_client: TestClient, db_session: Session) -> None:
    _seed_stream(db_session)
    db_session.commit()
    assert cleanup_client.post("/api/v1/runtime/logs/cleanup", json={"older_than_days": 0}).status_code == 422
    assert (
        cleanup_client.post("/api/v1/runtime/logs/cleanup", json={"older_than_days": 3651}).status_code == 422
    )
