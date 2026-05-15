"""Runtime delivery_logs search API — read-only filtered query."""

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


def _seed_stream_two_routes(db: Session) -> dict[str, int]:
    connector = Connector(name="logsearch-connector", description=None, status="RUNNING")
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
        name="logsearch-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db.add(stream)
    db.flush()
    d1 = Destination(
        name="ls-d1",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://a.example/h"},
        rate_limit_json={},
        enabled=True,
    )
    d2 = Destination(
        name="ls-d2",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://b.example/h"},
        rate_limit_json={},
        enabled=True,
    )
    db.add_all([d1, d2])
    db.flush()
    r1 = Route(
        stream_id=stream.id,
        destination_id=d1.id,
        enabled=True,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    r2 = Route(
        stream_id=stream.id,
        destination_id=d2.id,
        enabled=True,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    db.add_all([r1, r2])
    db.add(Checkpoint(stream_id=stream.id, checkpoint_type="CUSTOM_FIELD", checkpoint_value_json={}))
    db.commit()
    db.refresh(stream)
    db.refresh(r1)
    db.refresh(r2)
    return {
        "connector_id": connector.id,
        "stream_id": stream.id,
        "route_a_id": r1.id,
        "route_b_id": r2.id,
        "dest_a_id": d1.id,
        "dest_b_id": d2.id,
    }


def _log(
    db: Session,
    *,
    connector_id: int,
    stream_id: int,
    route_id: int | None,
    destination_id: int | None,
    stage: str,
    level: str = "INFO",
    status: str | None = "OK",
    message: str = "m",
    error_code: str | None = None,
    created_at: datetime | None = None,
    payload_sample: dict[str, Any] | None = None,
) -> None:
    db.add(
        DeliveryLog(
            connector_id=connector_id,
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
            stage=stage,
            level=level,
            status=status,
            message=message,
            payload_sample=payload_sample or {"secret": "x"},
            retry_count=0,
            http_status=None,
            latency_ms=None,
            error_code=error_code,
            created_at=created_at if created_at is not None else datetime.now(UTC),
        )
    )


@pytest.fixture
def logs_search_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_logs_search_success(logs_search_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="run_complete",
    )
    db_session.commit()

    response = logs_search_client.get("/api/v1/runtime/logs/search")
    assert response.status_code == 200
    body = response.json()
    assert body["total_returned"] >= 1
    assert len(body["logs"]) >= 1
    assert "payload_sample" not in body["logs"][0]


def test_filter_stream_id(logs_search_client: TestClient, db_session: Session) -> None:
    h1 = _seed_stream_two_routes(db_session)
    h2 = _seed_stream_two_routes(db_session)
    _log(
        db_session,
        connector_id=h1["connector_id"],
        stream_id=h1["stream_id"],
        route_id=h1["route_a_id"],
        destination_id=h1["dest_a_id"],
        stage="run_complete",
        message="s1",
    )
    _log(
        db_session,
        connector_id=h2["connector_id"],
        stream_id=h2["stream_id"],
        route_id=h2["route_a_id"],
        destination_id=h2["dest_a_id"],
        stage="run_complete",
        message="s2",
    )
    db_session.commit()

    body = logs_search_client.get("/api/v1/runtime/logs/search", params={"stream_id": h1["stream_id"]}).json()
    messages = {row["message"] for row in body["logs"]}
    assert "s1" in messages
    assert "s2" not in messages


def test_filter_route_id(logs_search_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="run_complete",
        message="ra",
    )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_b_id"],
        destination_id=h["dest_b_id"],
        stage="run_complete",
        message="rb",
    )
    db_session.commit()

    body = logs_search_client.get("/api/v1/runtime/logs/search", params={"route_id": h["route_a_id"]}).json()
    assert all(row["route_id"] == h["route_a_id"] for row in body["logs"])


def test_filter_destination_id(logs_search_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="run_complete",
        message="da",
    )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_b_id"],
        destination_id=h["dest_b_id"],
        stage="run_complete",
        message="db",
    )
    db_session.commit()

    body = logs_search_client.get(
        "/api/v1/runtime/logs/search",
        params={"destination_id": h["dest_b_id"]},
    ).json()
    assert all(row["destination_id"] == h["dest_b_id"] for row in body["logs"])


def test_filter_stage(logs_search_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_send_failed",
    )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_send_success",
    )
    db_session.commit()

    body = logs_search_client.get("/api/v1/runtime/logs/search", params={"stage": "route_send_failed"}).json()
    assert all(row["stage"] == "route_send_failed" for row in body["logs"])


def test_filter_level_status_error_code(logs_search_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    t = datetime.now(UTC)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_send_failed",
        level="ERROR",
        status="FAILED",
        error_code="E1",
        message="e1",
        created_at=t,
    )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_send_failed",
        level="INFO",
        status="OK",
        error_code="E2",
        message="e2",
        created_at=t,
    )
    db_session.commit()

    assert (
        len(
            logs_search_client.get("/api/v1/runtime/logs/search", params={"level": "ERROR"}).json()["logs"]
        )
        == 1
    )
    assert (
        len(
            logs_search_client.get("/api/v1/runtime/logs/search", params={"status": "FAILED"}).json()["logs"]
        )
        == 1
    )
    assert (
        len(
            logs_search_client.get("/api/v1/runtime/logs/search", params={"error_code": "E1"}).json()["logs"]
        )
        == 1
    )


def test_order_created_at_desc_id_desc(logs_search_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    ts = datetime.now(UTC)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="run_complete",
        message="older_row",
        created_at=ts,
    )
    db_session.flush()
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="run_complete",
        message="newer_row",
        created_at=ts,
    )
    db_session.commit()

    logs_body = logs_search_client.get(
        "/api/v1/runtime/logs/search",
        params={"stream_id": h["stream_id"]},
    ).json()["logs"]
    assert len(logs_body) == 2
    assert logs_body[0]["message"] == "newer_row"
    assert logs_body[1]["message"] == "older_row"


def test_limit_applied(logs_search_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    base = datetime.now(UTC)
    for i in range(5):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="run_complete",
            message=f"m{i}",
            created_at=base - timedelta(seconds=i),
        )
    db_session.commit()

    body = logs_search_client.get("/api/v1/runtime/logs/search", params={"limit": 2, "stream_id": h["stream_id"]}).json()
    assert body["total_returned"] == 2
    assert len(body["logs"]) == 2


def test_limit_validation_422(logs_search_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    db_session.commit()
    assert logs_search_client.get("/api/v1/runtime/logs/search", params={"limit": 0}).status_code == 422
    assert logs_search_client.get("/api/v1/runtime/logs/search", params={"limit": 9000}).status_code == 422


def test_payload_sample_never_in_response(logs_search_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="run_complete",
        payload_sample={"x": "y"},
    )
    db_session.commit()

    raw = logs_search_client.get("/api/v1/runtime/logs/search").text
    assert "payload_sample" not in raw


def test_no_commit_or_rollback(
    monkeypatch: pytest.MonkeyPatch,
    logs_search_client: TestClient,
    db_session: Session,
) -> None:
    _seed_stream_two_routes(db_session)
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

    assert logs_search_client.get("/api/v1/runtime/logs/search").status_code == 200
    assert commit_calls["n"] == 0
    assert rollback_calls["n"] == 0


def test_no_extra_delivery_logs(logs_search_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="run_complete",
    )
    db_session.commit()
    before = db_session.query(DeliveryLog).count()
    logs_search_client.get("/api/v1/runtime/logs/search")
    assert db_session.query(DeliveryLog).count() == before
