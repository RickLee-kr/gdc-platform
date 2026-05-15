"""Runtime logs cursor pagination API — read-only paged delivery_logs."""

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
    connector = Connector(name="logpage-connector", description=None, status="RUNNING")
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
        name="logpage-stream",
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
        name="lp-d1",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://a.example/h"},
        rate_limit_json={},
        enabled=True,
    )
    d2 = Destination(
        name="lp-d2",
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
            created_at=created_at or datetime(2026, 7, 1, 10, 0, 0, tzinfo=UTC),
        )
    )
    db.flush()


@pytest.fixture
def logs_page_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_logs_page_first_page_success(logs_page_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="run_complete",
        message="one",
    )
    db_session.commit()

    r = logs_page_client.get("/api/v1/runtime/logs/page")
    assert r.status_code == 200
    body = r.json()
    assert body["total_returned"] == 1
    assert body["has_next"] is False
    assert body["items"][0]["message"] == "one"
    assert body["next_cursor_created_at"] is not None
    assert body["next_cursor_id"] is not None


def test_logs_page_order_created_at_desc_id_desc(logs_page_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    ts = datetime(2026, 7, 2, 12, 0, 0, tzinfo=UTC)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="run_complete",
        message="lower_id",
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
        message="higher_id",
        created_at=ts,
    )
    db_session.commit()

    items = logs_page_client.get("/api/v1/runtime/logs/page").json()["items"]
    assert len(items) == 2
    assert items[0]["message"] == "higher_id"
    assert items[1]["message"] == "lower_id"
    assert items[0]["id"] > items[1]["id"]


def test_logs_page_limit_applied(logs_page_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    base = datetime(2026, 7, 3, 8, 0, 0, tzinfo=UTC)
    for i in range(5):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="run_complete",
            message=f"m{i}",
            created_at=base + timedelta(seconds=i),
        )
    db_session.commit()

    body = logs_page_client.get("/api/v1/runtime/logs/page", params={"limit": 2}).json()
    assert body["total_returned"] == 2
    assert len(body["items"]) == 2


def test_logs_page_has_next_true(logs_page_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    base = datetime(2026, 7, 4, 9, 0, 0, tzinfo=UTC)
    for i in range(4):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="run_complete",
            created_at=base + timedelta(seconds=i),
        )
    db_session.commit()

    body = logs_page_client.get("/api/v1/runtime/logs/page", params={"limit": 2}).json()
    assert body["has_next"] is True
    assert body["total_returned"] == 2


def test_logs_page_has_next_false_exact_limit(logs_page_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    base = datetime(2026, 7, 5, 10, 0, 0, tzinfo=UTC)
    for i in range(3):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="run_complete",
            created_at=base + timedelta(seconds=i),
        )
    db_session.commit()

    body = logs_page_client.get("/api/v1/runtime/logs/page", params={"limit": 3}).json()
    assert body["has_next"] is False
    assert body["total_returned"] == 3


def test_logs_page_next_cursor_matches_last_item(logs_page_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    base = datetime(2026, 7, 6, 11, 0, 0, tzinfo=UTC)
    for i in range(2):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="run_complete",
            created_at=base + timedelta(seconds=i),
        )
    db_session.commit()

    body = logs_page_client.get("/api/v1/runtime/logs/page", params={"limit": 2}).json()
    last = body["items"][-1]
    assert body["next_cursor_id"] == last["id"]
    assert body["next_cursor_created_at"] == last["created_at"]


def test_logs_page_second_page_no_overlap(logs_page_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    base = datetime(2026, 7, 7, 12, 0, 0, tzinfo=UTC)
    messages = []
    for i in range(5):
        msg = f"row{i}"
        messages.append(msg)
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="run_complete",
            message=msg,
            created_at=base + timedelta(seconds=i),
        )
    db_session.commit()

    p1 = logs_page_client.get("/api/v1/runtime/logs/page", params={"limit": 2}).json()
    assert p1["has_next"] is True
    ids_p1 = {x["id"] for x in p1["items"]}

    p2 = logs_page_client.get(
        "/api/v1/runtime/logs/page",
        params={
            "limit": 2,
            "cursor_created_at": p1["next_cursor_created_at"],
            "cursor_id": p1["next_cursor_id"],
        },
    ).json()
    ids_p2 = {x["id"] for x in p2["items"]}
    assert ids_p1.isdisjoint(ids_p2)
    assert p2["total_returned"] == 2


def test_logs_page_cursor_created_at_only_422(logs_page_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    db_session.commit()
    r = logs_page_client.get(
        "/api/v1/runtime/logs/page",
        params={"cursor_created_at": "2026-07-08T10:00:00+00:00"},
    )
    assert r.status_code == 422
    assert r.json()["detail"]["error_code"] == "INVALID_CURSOR"


def test_logs_page_cursor_id_only_422(logs_page_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    db_session.commit()
    r = logs_page_client.get("/api/v1/runtime/logs/page", params={"cursor_id": 99})
    assert r.status_code == 422
    assert r.json()["detail"]["error_code"] == "INVALID_CURSOR"


def test_logs_page_filter_stream_id(logs_page_client: TestClient, db_session: Session) -> None:
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

    body = logs_page_client.get(
        "/api/v1/runtime/logs/page",
        params={"stream_id": h1["stream_id"]},
    ).json()
    assert len(body["items"]) == 1
    assert body["items"][0]["message"] == "s1"


def test_logs_page_filter_route_id(logs_page_client: TestClient, db_session: Session) -> None:
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

    body = logs_page_client.get(
        "/api/v1/runtime/logs/page",
        params={"route_id": h["route_b_id"]},
    ).json()
    assert len(body["items"]) == 1
    assert body["items"][0]["message"] == "rb"


def test_logs_page_filter_destination_id(logs_page_client: TestClient, db_session: Session) -> None:
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

    body = logs_page_client.get(
        "/api/v1/runtime/logs/page",
        params={"destination_id": h["dest_a_id"]},
    ).json()
    assert len(body["items"]) == 1
    assert body["items"][0]["message"] == "da"


def test_logs_page_filter_stage_level_status_error_code(logs_page_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    t = datetime(2026, 7, 9, 9, 0, 0, tzinfo=UTC)
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
        message="a",
        created_at=t,
    )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="run_complete",
        level="INFO",
        status="OK",
        error_code="E2",
        message="b",
        created_at=t,
    )
    db_session.commit()

    assert (
        len(
            logs_page_client.get("/api/v1/runtime/logs/page", params={"stage": "route_send_failed"}).json()["items"]
        )
        == 1
    )
    assert (
        len(logs_page_client.get("/api/v1/runtime/logs/page", params={"level": "ERROR"}).json()["items"]) == 1
    )
    assert (
        len(logs_page_client.get("/api/v1/runtime/logs/page", params={"status": "FAILED"}).json()["items"]) == 1
    )
    assert (
        len(logs_page_client.get("/api/v1/runtime/logs/page", params={"error_code": "E1"}).json()["items"]) == 1
    )


def test_logs_page_empty_next_cursor_null(logs_page_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    db_session.commit()

    body = logs_page_client.get("/api/v1/runtime/logs/page").json()
    assert body["total_returned"] == 0
    assert body["has_next"] is False
    assert body["items"] == []
    assert body["next_cursor_created_at"] is None
    assert body["next_cursor_id"] is None


def test_logs_page_payload_sample_not_in_response(logs_page_client: TestClient, db_session: Session) -> None:
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

    raw = logs_page_client.get("/api/v1/runtime/logs/page").text
    assert "payload_sample" not in raw
    assert "secret" not in raw


def test_logs_page_no_commit_or_rollback(
    monkeypatch: pytest.MonkeyPatch,
    logs_page_client: TestClient,
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

    assert logs_page_client.get("/api/v1/runtime/logs/page").status_code == 200
    assert commit_calls["n"] == 0
    assert rollback_calls["n"] == 0


def test_logs_page_limit_validation_422(logs_page_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    db_session.commit()
    assert logs_page_client.get("/api/v1/runtime/logs/page", params={"limit": 0}).status_code == 422
    assert logs_page_client.get("/api/v1/runtime/logs/page", params={"limit": 501}).status_code == 422
