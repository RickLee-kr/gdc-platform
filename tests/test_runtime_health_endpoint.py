"""Runtime stream health API — read-only health from recent delivery_logs."""

from __future__ import annotations

from datetime import datetime, timezone
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


def _seed_routes(
    db: Session,
    *,
    route_a_enabled: bool = True,
    route_b_enabled: bool = True,
) -> dict[str, Any]:
    connector = Connector(name="h-connector", description=None, status="RUNNING")
    db.add(connector)
    db.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={},
        auth_json={},
        enabled=True,
    )
    db.add(source)
    db.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="h-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db.add(stream)
    db.flush()

    dest_a = Destination(
        name="h-dest-a",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://a.example/hook"},
        rate_limit_json={},
        enabled=True,
    )
    dest_b = Destination(
        name="h-dest-b",
        destination_type="SYSLOG_UDP",
        config_json={"host": "10.0.0.1", "port": 5514},
        rate_limit_json={},
        enabled=True,
    )
    db.add_all([dest_a, dest_b])
    db.flush()

    route_a = Route(
        stream_id=stream.id,
        destination_id=dest_a.id,
        enabled=route_a_enabled,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    route_b = Route(
        stream_id=stream.id,
        destination_id=dest_b.id,
        enabled=route_b_enabled,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    db.add_all([route_a, route_b])
    db.flush()

    checkpoint = Checkpoint(
        stream_id=stream.id,
        checkpoint_type="EVENT_ID",
        checkpoint_value_json={},
    )
    db.add(checkpoint)
    db.commit()
    db.refresh(stream)
    db.refresh(route_a)
    db.refresh(route_b)

    return {
        "connector_id": connector.id,
        "stream_id": stream.id,
        "route_a_id": route_a.id,
        "route_b_id": route_b.id,
        "dest_a_id": dest_a.id,
        "dest_b_id": dest_b.id,
    }


def _log(
    db: Session,
    *,
    connector_id: int,
    stream_id: int,
    route_id: int | None,
    destination_id: int | None,
    stage: str,
    created_at: datetime,
    message: str = "m",
    error_code: str | None = None,
) -> None:
    db.add(
        DeliveryLog(
            connector_id=connector_id,
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
            stage=stage,
            level="INFO",
            status="OK",
            message=message,
            payload_sample={},
            retry_count=0,
            error_code=error_code,
            created_at=created_at,
        )
    )


@pytest.fixture
def health_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_stream_health_healthy(health_client: TestClient, db_session: Session) -> None:
    s = _seed_routes(db_session)
    t = datetime(2026, 5, 6, 10, 0, 0, tzinfo=UTC)
    _log(
        db_session,
        connector_id=s["connector_id"],
        stream_id=s["stream_id"],
        route_id=s["route_a_id"],
        destination_id=s["dest_a_id"],
        stage="route_send_success",
        created_at=t,
    )
    db_session.commit()

    body = health_client.get(f"/api/v1/runtime/health/stream/{s['stream_id']}").json()
    assert body["health"] == "HEALTHY"
    assert body["summary"]["healthy_routes"] == 1
    assert body["summary"]["idle_routes"] == 1
    ra = next(r for r in body["routes"] if r["route_id"] == s["route_a_id"])
    assert ra["health"] == "HEALTHY"


def test_stream_health_degraded(health_client: TestClient, db_session: Session) -> None:
    s = _seed_routes(db_session)
    t = datetime(2026, 5, 6, 11, 0, 0, tzinfo=UTC)
    _log(
        db_session,
        connector_id=s["connector_id"],
        stream_id=s["stream_id"],
        route_id=s["route_a_id"],
        destination_id=s["dest_a_id"],
        stage="route_send_success",
        created_at=t,
    )
    _log(
        db_session,
        connector_id=s["connector_id"],
        stream_id=s["stream_id"],
        route_id=s["route_a_id"],
        destination_id=s["dest_a_id"],
        stage="route_send_failed",
        created_at=t,
    )
    db_session.commit()

    body = health_client.get(f"/api/v1/runtime/health/stream/{s['stream_id']}").json()
    assert body["health"] == "DEGRADED"
    assert body["summary"]["degraded_routes"] == 1


def test_stream_health_unhealthy(health_client: TestClient, db_session: Session) -> None:
    s = _seed_routes(db_session)
    t = datetime(2026, 5, 6, 12, 0, 0, tzinfo=UTC)
    _log(
        db_session,
        connector_id=s["connector_id"],
        stream_id=s["stream_id"],
        route_id=s["route_a_id"],
        destination_id=s["dest_a_id"],
        stage="route_send_failed",
        created_at=t,
    )
    db_session.commit()

    body = health_client.get(f"/api/v1/runtime/health/stream/{s['stream_id']}").json()
    assert body["health"] == "UNHEALTHY"
    ra = next(r for r in body["routes"] if r["route_id"] == s["route_a_id"])
    assert ra["health"] == "UNHEALTHY"


def test_stream_health_idle_no_logs(health_client: TestClient, db_session: Session) -> None:
    s = _seed_routes(db_session)
    body = health_client.get(f"/api/v1/runtime/health/stream/{s['stream_id']}").json()
    assert body["health"] == "IDLE"
    assert body["summary"]["idle_routes"] == 2


def test_route_disabled_health(health_client: TestClient, db_session: Session) -> None:
    s = _seed_routes(db_session, route_a_enabled=False, route_b_enabled=True)
    t = datetime(2026, 5, 6, 13, 0, 0, tzinfo=UTC)
    _log(
        db_session,
        connector_id=s["connector_id"],
        stream_id=s["stream_id"],
        route_id=s["route_b_id"],
        destination_id=s["dest_b_id"],
        stage="route_send_success",
        created_at=t,
    )
    db_session.commit()

    body = health_client.get(f"/api/v1/runtime/health/stream/{s['stream_id']}").json()
    routes = {r["route_id"]: r for r in body["routes"]}
    assert routes[s["route_a_id"]]["health"] == "DISABLED"
    assert routes[s["route_b_id"]]["health"] == "HEALTHY"
    assert body["summary"]["disabled_routes"] == 1


def test_consecutive_failure_count(health_client: TestClient, db_session: Session) -> None:
    s = _seed_routes(db_session)
    # Newest first after DESC fetch: fail, dest rl, run_complete, retry success (oldest)
    _log(
        db_session,
        connector_id=s["connector_id"],
        stream_id=s["stream_id"],
        route_id=s["route_a_id"],
        destination_id=s["dest_a_id"],
        stage="route_send_failed",
        created_at=datetime(2026, 5, 6, 16, 3, 0, tzinfo=UTC),
    )
    _log(
        db_session,
        connector_id=s["connector_id"],
        stream_id=s["stream_id"],
        route_id=s["route_a_id"],
        destination_id=s["dest_a_id"],
        stage="destination_rate_limited",
        created_at=datetime(2026, 5, 6, 16, 2, 0, tzinfo=UTC),
    )
    _log(
        db_session,
        connector_id=s["connector_id"],
        stream_id=s["stream_id"],
        route_id=s["route_a_id"],
        destination_id=s["dest_a_id"],
        stage="run_complete",
        created_at=datetime(2026, 5, 6, 16, 1, 0, tzinfo=UTC),
    )
    _log(
        db_session,
        connector_id=s["connector_id"],
        stream_id=s["stream_id"],
        route_id=s["route_a_id"],
        destination_id=s["dest_a_id"],
        stage="route_retry_success",
        created_at=datetime(2026, 5, 6, 16, 0, 0, tzinfo=UTC),
    )
    db_session.commit()

    ra = next(
        r
        for r in health_client.get(f"/api/v1/runtime/health/stream/{s['stream_id']}").json()["routes"]
        if r["route_id"] == s["route_a_id"]
    )
    assert ra["consecutive_failure_count"] == 2


def test_last_error_code_and_message(health_client: TestClient, db_session: Session) -> None:
    s = _seed_routes(db_session)
    _log(
        db_session,
        connector_id=s["connector_id"],
        stream_id=s["stream_id"],
        route_id=s["route_a_id"],
        destination_id=s["dest_a_id"],
        stage="route_send_failed",
        created_at=datetime(2026, 5, 6, 17, 1, 0, tzinfo=UTC),
        message="older",
        error_code="OLD",
    )
    _log(
        db_session,
        connector_id=s["connector_id"],
        stream_id=s["stream_id"],
        route_id=s["route_a_id"],
        destination_id=s["dest_a_id"],
        stage="destination_rate_limited",
        created_at=datetime(2026, 5, 6, 17, 2, 0, tzinfo=UTC),
        message="newer-rl",
        error_code="RL",
    )
    db_session.commit()

    ra = next(
        r
        for r in health_client.get(f"/api/v1/runtime/health/stream/{s['stream_id']}").json()["routes"]
        if r["route_id"] == s["route_a_id"]
    )
    assert ra["last_error_code"] == "RL"
    assert ra["last_error_message"] == "newer-rl"


def test_stream_not_found(health_client: TestClient, db_session: Session) -> None:
    _seed_routes(db_session)
    response = health_client.get("/api/v1/runtime/health/stream/999999")
    assert response.status_code == 404
    assert response.json()["detail"]["error_code"] == "STREAM_NOT_FOUND"


def test_limit_validation_422(health_client: TestClient, db_session: Session) -> None:
    s = _seed_routes(db_session)
    assert health_client.get(f"/api/v1/runtime/health/stream/{s['stream_id']}", params={"limit": 0}).status_code == 422
    assert (
        health_client.get(f"/api/v1/runtime/health/stream/{s['stream_id']}", params={"limit": 5000}).status_code == 422
    )


def test_endpoint_no_commit_or_rollback(
    monkeypatch: pytest.MonkeyPatch,
    health_client: TestClient,
    db_session: Session,
) -> None:
    s = _seed_routes(db_session)
    _log(
        db_session,
        connector_id=s["connector_id"],
        stream_id=s["stream_id"],
        route_id=s["route_a_id"],
        destination_id=s["dest_a_id"],
        stage="run_complete",
        created_at=datetime(2026, 5, 6, 18, 0, 0, tzinfo=UTC),
    )
    db_session.commit()

    commit_calls = {"n": 0}
    rollback_calls = {"n": 0}
    real_commit = Session.commit
    real_rollback = Session.rollback

    def _counting_commit(self: Any, *args: Any, **kwargs: Any) -> None:
        commit_calls["n"] += 1
        return real_commit(self, *args, **kwargs)

    def _counting_rollback(self: Any, *args: Any, **kwargs: Any) -> None:
        rollback_calls["n"] += 1
        return real_rollback(self, *args, **kwargs)

    monkeypatch.setattr("sqlalchemy.orm.session.Session.commit", _counting_commit)
    monkeypatch.setattr("sqlalchemy.orm.session.Session.rollback", _counting_rollback)

    response = health_client.get(f"/api/v1/runtime/health/stream/{s['stream_id']}")
    assert response.status_code == 200
    assert commit_calls["n"] == 0
    assert rollback_calls["n"] == 0


def test_no_extra_delivery_logs(health_client: TestClient, db_session: Session) -> None:
    s = _seed_routes(db_session)
    _log(
        db_session,
        connector_id=s["connector_id"],
        stream_id=s["stream_id"],
        route_id=s["route_a_id"],
        destination_id=s["dest_a_id"],
        stage="run_complete",
        created_at=datetime(2026, 5, 6, 19, 0, 0, tzinfo=UTC),
    )
    db_session.commit()
    before = db_session.query(DeliveryLog).filter(DeliveryLog.stream_id == s["stream_id"]).count()
    health_client.get(f"/api/v1/runtime/health/stream/{s['stream_id']}")
    after = db_session.query(DeliveryLog).filter(DeliveryLog.stream_id == s["stream_id"]).count()
    assert before == after


def test_all_routes_disabled_stream_idle(health_client: TestClient, db_session: Session) -> None:
    s = _seed_routes(db_session, route_a_enabled=False, route_b_enabled=False)
    _log(
        db_session,
        connector_id=s["connector_id"],
        stream_id=s["stream_id"],
        route_id=s["route_a_id"],
        destination_id=s["dest_a_id"],
        stage="route_send_failed",
        created_at=datetime(2026, 5, 6, 20, 0, 0, tzinfo=UTC),
    )
    db_session.commit()

    body = health_client.get(f"/api/v1/runtime/health/stream/{s['stream_id']}").json()
    assert body["health"] == "IDLE"
    assert body["summary"]["disabled_routes"] == 2
