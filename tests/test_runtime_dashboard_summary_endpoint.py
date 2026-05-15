"""Runtime dashboard summary API — read-only global aggregates + recent delivery_logs."""

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


@pytest.fixture(autouse=True)
def _clear_runtime_dashboard_read_cache() -> None:
    from app.runtime.dashboard_read_cache import clear_dashboard_read_cache

    clear_dashboard_read_cache()
    yield


def _mk_stream_hierarchy(
    db: Session,
    *,
    stream_status: str,
    route_enabled: bool = True,
    destination_enabled: bool = True,
) -> dict[str, Any]:
    connector = Connector(name="dash-connector", description=None, status="RUNNING")
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
        name=f"dash-{stream_status}",
        stream_type="HTTP_API_POLLING",
        config_json={},
        polling_interval=60,
        enabled=True,
        status=stream_status,
        rate_limit_json={},
    )
    db.add(stream)
    db.flush()
    destination = Destination(
        name="dash-dest",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://x.example/hook"},
        rate_limit_json={},
        enabled=destination_enabled,
    )
    db.add(destination)
    db.flush()
    route = Route(
        stream_id=stream.id,
        destination_id=destination.id,
        enabled=route_enabled,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    db.add(route)
    db.flush()
    checkpoint = Checkpoint(stream_id=stream.id, checkpoint_type="CUSTOM_FIELD", checkpoint_value_json={})
    db.add(checkpoint)
    db.commit()
    db.refresh(stream)
    db.refresh(route)
    db.refresh(destination)
    return {
        "connector_id": connector.id,
        "stream_id": stream.id,
        "route_id": route.id,
        "destination_id": destination.id,
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
    message: str = "msg",
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
def dashboard_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_dashboard_summary_success(dashboard_client: TestClient, db_session: Session) -> None:
    h = _mk_stream_hierarchy(db_session, stream_status="RUNNING")
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_id"],
        destination_id=h["destination_id"],
        stage="route_send_success",
        created_at=datetime(2026, 6, 1, 10, 0, 0, tzinfo=UTC),
    )
    db_session.commit()

    response = dashboard_client.get("/api/v1/runtime/dashboard/summary")
    assert response.status_code == 200
    body = response.json()
    assert "summary" in body
    assert body["summary"]["total_streams"] >= 1


def test_stream_status_counts(dashboard_client: TestClient, db_session: Session) -> None:
    _mk_stream_hierarchy(db_session, stream_status="RUNNING")
    _mk_stream_hierarchy(db_session, stream_status="PAUSED")
    _mk_stream_hierarchy(db_session, stream_status="ERROR")
    _mk_stream_hierarchy(db_session, stream_status="STOPPED")
    _mk_stream_hierarchy(db_session, stream_status="RATE_LIMITED_SOURCE")
    _mk_stream_hierarchy(db_session, stream_status="RATE_LIMITED_DESTINATION")
    _mk_stream_hierarchy(db_session, stream_status="CUSTOM_UNKNOWN")

    db_session.commit()

    s = dashboard_client.get("/api/v1/runtime/dashboard/summary").json()["summary"]
    assert s["total_streams"] >= 7
    assert s["running_streams"] >= 1
    assert s["paused_streams"] >= 1
    assert s["error_streams"] >= 1
    assert s["stopped_streams"] >= 1
    assert s["rate_limited_source_streams"] >= 1
    assert s["rate_limited_destination_streams"] >= 1


def test_route_enabled_disabled_counts(dashboard_client: TestClient, db_session: Session) -> None:
    _mk_stream_hierarchy(db_session, stream_status="RUNNING", route_enabled=True)
    _mk_stream_hierarchy(db_session, stream_status="RUNNING", route_enabled=False)
    db_session.commit()

    s = dashboard_client.get("/api/v1/runtime/dashboard/summary").json()["summary"]
    assert s["total_routes"] >= 2
    assert s["enabled_routes"] >= 1
    assert s["disabled_routes"] >= 1
    assert s["enabled_routes"] + s["disabled_routes"] == s["total_routes"]


def test_destination_enabled_disabled_counts(dashboard_client: TestClient, db_session: Session) -> None:
    _mk_stream_hierarchy(db_session, stream_status="RUNNING", destination_enabled=True)
    _mk_stream_hierarchy(db_session, stream_status="RUNNING", destination_enabled=False)
    db_session.commit()

    s = dashboard_client.get("/api/v1/runtime/dashboard/summary").json()["summary"]
    assert s["total_destinations"] >= 2
    assert s["enabled_destinations"] >= 1
    assert s["disabled_destinations"] >= 1
    assert s["enabled_destinations"] + s["disabled_destinations"] == s["total_destinations"]


def test_recent_category_counts(dashboard_client: TestClient, db_session: Session) -> None:
    h = _mk_stream_hierarchy(db_session, stream_status="RUNNING")
    cid = h["connector_id"]
    sid = h["stream_id"]
    rid = h["route_id"]
    did = h["destination_id"]
    base = datetime(2026, 6, 2, 12, 0, 0, tzinfo=UTC)
    _log(db_session, connector_id=cid, stream_id=sid, route_id=rid, destination_id=did, stage="route_send_success", created_at=base)
    _log(db_session, connector_id=cid, stream_id=sid, route_id=rid, destination_id=did, stage="route_retry_success", created_at=base)
    _log(db_session, connector_id=cid, stream_id=sid, route_id=rid, destination_id=did, stage="route_send_failed", created_at=base)
    _log(db_session, connector_id=cid, stream_id=sid, route_id=rid, destination_id=did, stage="route_retry_failed", created_at=base)
    _log(db_session, connector_id=cid, stream_id=sid, route_id=rid, destination_id=did, stage="route_unknown_failure_policy", created_at=base)
    _log(db_session, connector_id=cid, stream_id=sid, route_id=None, destination_id=None, stage="source_rate_limited", created_at=base)
    _log(db_session, connector_id=cid, stream_id=sid, route_id=rid, destination_id=did, stage="destination_rate_limited", created_at=base)
    db_session.commit()

    s = dashboard_client.get("/api/v1/runtime/dashboard/summary", params={"limit": 100}).json()["summary"]
    assert s["recent_logs"] == 7
    assert s["recent_successes"] == 2
    assert s["recent_failures"] == 3
    assert s["recent_rate_limited"] == 2


def test_recent_problem_routes_dedupe_by_route_id(dashboard_client: TestClient, db_session: Session) -> None:
    h = _mk_stream_hierarchy(db_session, stream_status="RUNNING")
    rid = h["route_id"]
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=rid,
        destination_id=h["destination_id"],
        stage="route_send_failed",
        created_at=datetime(2026, 6, 3, 10, 0, 0, tzinfo=UTC),
        message="older",
        error_code="OLD",
    )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=rid,
        destination_id=h["destination_id"],
        stage="route_send_failed",
        created_at=datetime(2026, 6, 3, 11, 0, 0, tzinfo=UTC),
        message="newer",
        error_code="NEW",
    )
    db_session.commit()

    routes = dashboard_client.get("/api/v1/runtime/dashboard/summary").json()["recent_problem_routes"]
    matching = [r for r in routes if r["route_id"] == rid]
    assert len(matching) == 1
    assert matching[0]["message"] == "newer"
    assert matching[0]["error_code"] == "NEW"


def test_recent_rate_limited_routes_dedupe_by_route_id(dashboard_client: TestClient, db_session: Session) -> None:
    h = _mk_stream_hierarchy(db_session, stream_status="RUNNING")
    rid = h["route_id"]
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=rid,
        destination_id=h["destination_id"],
        stage="destination_rate_limited",
        created_at=datetime(2026, 6, 4, 10, 0, 0, tzinfo=UTC),
        message="older-rl",
    )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=rid,
        destination_id=h["destination_id"],
        stage="destination_rate_limited",
        created_at=datetime(2026, 6, 4, 11, 0, 0, tzinfo=UTC),
        message="newer-rl",
    )
    db_session.commit()

    routes = dashboard_client.get("/api/v1/runtime/dashboard/summary").json()["recent_rate_limited_routes"]
    matching = [r for r in routes if r["route_id"] == rid]
    assert len(matching) == 1
    assert matching[0]["message"] == "newer-rl"


def test_recent_unhealthy_streams_dedupe_by_stream_id(dashboard_client: TestClient, db_session: Session) -> None:
    h = _mk_stream_hierarchy(db_session, stream_status="RUNNING")
    sid = h["stream_id"]
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=sid,
        route_id=h["route_id"],
        destination_id=h["destination_id"],
        stage="route_send_failed",
        created_at=datetime(2026, 6, 5, 10, 0, 0, tzinfo=UTC),
        message="first",
    )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=sid,
        route_id=None,
        destination_id=None,
        stage="source_rate_limited",
        created_at=datetime(2026, 6, 5, 11, 0, 0, tzinfo=UTC),
        message="second",
    )
    db_session.commit()

    unhealthy = dashboard_client.get("/api/v1/runtime/dashboard/summary").json()["recent_unhealthy_streams"]
    matching = [u for u in unhealthy if u["stream_id"] == sid]
    assert len(matching) == 1
    assert matching[0]["last_problem_stage"] == "source_rate_limited"
    assert matching[0]["last_error_message"] == "second"


def test_limit_validation_422(dashboard_client: TestClient, db_session: Session) -> None:
    _mk_stream_hierarchy(db_session, stream_status="RUNNING")
    db_session.commit()
    assert dashboard_client.get("/api/v1/runtime/dashboard/summary", params={"limit": 0}).status_code == 422
    assert dashboard_client.get("/api/v1/runtime/dashboard/summary", params={"limit": 5000}).status_code == 422


def test_no_commit_or_rollback(
    monkeypatch: pytest.MonkeyPatch,
    dashboard_client: TestClient,
    db_session: Session,
) -> None:
    _mk_stream_hierarchy(db_session, stream_status="RUNNING")
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

    assert dashboard_client.get("/api/v1/runtime/dashboard/summary").status_code == 200
    assert commit_calls["n"] == 0
    assert rollback_calls["n"] == 0


def test_no_extra_delivery_logs(dashboard_client: TestClient, db_session: Session) -> None:
    h = _mk_stream_hierarchy(db_session, stream_status="RUNNING")
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_id"],
        destination_id=h["destination_id"],
        stage="run_complete",
        created_at=datetime(2026, 6, 6, 8, 0, 0, tzinfo=UTC),
    )
    db_session.commit()
    before = db_session.query(DeliveryLog).count()
    dashboard_client.get("/api/v1/runtime/dashboard/summary")
    assert db_session.query(DeliveryLog).count() == before
