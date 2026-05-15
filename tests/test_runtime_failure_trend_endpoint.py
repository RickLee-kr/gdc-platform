"""Runtime failure trend API — aggregated failure / rate-limit delivery_logs (read-only)."""

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
    connector = Connector(name="ftrend-connector", description=None, status="RUNNING")
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
        name="ftrend-stream",
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
        name="ft-d1",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://a.example/h"},
        rate_limit_json={},
        enabled=True,
    )
    d2 = Destination(
        name="ft-d2",
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
            level="ERROR",
            status="FAILED",
            message=message,
            payload_sample=payload_sample or {"secret": "x"},
            retry_count=0,
            http_status=None,
            latency_ms=None,
            error_code=error_code,
            created_at=created_at or datetime(2026, 6, 1, 10, 0, 0, tzinfo=UTC),
        )
    )


@pytest.fixture
def failure_trend_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_failure_trend_success(failure_trend_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    t = datetime(2026, 6, 2, 12, 0, 0, tzinfo=UTC)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_send_failed",
        error_code="E_FAIL",
        created_at=t,
    )
    db_session.commit()

    r = failure_trend_client.get("/api/v1/runtime/failures/trend")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert len(body["buckets"]) == 1
    b = body["buckets"][0]
    assert b["stage"] == "route_send_failed"
    assert b["count"] == 1
    assert b["stream_id"] == h["stream_id"]
    assert b["route_id"] == h["route_a_id"]
    assert b["destination_id"] == h["dest_a_id"]
    assert b["error_code"] == "E_FAIL"


def test_failure_trend_only_failure_stages(failure_trend_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    stages = (
        "route_send_failed",
        "route_retry_failed",
        "route_unknown_failure_policy",
        "source_rate_limited",
        "destination_rate_limited",
    )
    base_t = datetime(2026, 6, 3, 8, 0, 0, tzinfo=UTC)
    for i, st in enumerate(stages):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage=st,
            error_code=f"E{i}",
            created_at=datetime(2026, 6, 3, 8, i, 0, tzinfo=UTC),
        )
    db_session.commit()

    body = failure_trend_client.get("/api/v1/runtime/failures/trend").json()
    got_stages = {x["stage"] for x in body["buckets"]}
    assert got_stages == set(stages)


def test_failure_trend_excludes_success_stages(failure_trend_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_send_success",
        error_code=None,
    )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_send_failed",
        error_code="ONLY_FAIL",
    )
    db_session.commit()

    body = failure_trend_client.get("/api/v1/runtime/failures/trend").json()
    assert body["total"] == 1
    assert body["buckets"][0]["stage"] == "route_send_failed"
    assert body["buckets"][0]["error_code"] == "ONLY_FAIL"


def test_failure_trend_filter_stream_id(failure_trend_client: TestClient, db_session: Session) -> None:
    h1 = _seed_stream_two_routes(db_session)
    h2 = _seed_stream_two_routes(db_session)
    _log(
        db_session,
        connector_id=h1["connector_id"],
        stream_id=h1["stream_id"],
        route_id=h1["route_a_id"],
        destination_id=h1["dest_a_id"],
        stage="route_send_failed",
        error_code="S1",
    )
    _log(
        db_session,
        connector_id=h2["connector_id"],
        stream_id=h2["stream_id"],
        route_id=h2["route_a_id"],
        destination_id=h2["dest_a_id"],
        stage="route_send_failed",
        error_code="S2",
    )
    db_session.commit()

    body = failure_trend_client.get(
        "/api/v1/runtime/failures/trend",
        params={"stream_id": h1["stream_id"]},
    ).json()
    codes = {b["error_code"] for b in body["buckets"]}
    assert codes == {"S1"}


def test_failure_trend_filter_route_id(failure_trend_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_send_failed",
        error_code="RA",
    )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_b_id"],
        destination_id=h["dest_b_id"],
        stage="route_send_failed",
        error_code="RB",
    )
    db_session.commit()

    body = failure_trend_client.get(
        "/api/v1/runtime/failures/trend",
        params={"route_id": h["route_a_id"]},
    ).json()
    assert len(body["buckets"]) == 1
    assert body["buckets"][0]["error_code"] == "RA"


def test_failure_trend_filter_destination_id(failure_trend_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_send_failed",
        error_code="DA",
    )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_b_id"],
        destination_id=h["dest_b_id"],
        stage="route_send_failed",
        error_code="DB",
    )
    db_session.commit()

    body = failure_trend_client.get(
        "/api/v1/runtime/failures/trend",
        params={"destination_id": h["dest_b_id"]},
    ).json()
    assert len(body["buckets"]) == 1
    assert body["buckets"][0]["error_code"] == "DB"


def test_failure_trend_limit_buckets(failure_trend_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    base = datetime(2026, 6, 4, 10, 0, 0, tzinfo=UTC)
    for i in range(5):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="route_send_failed",
            error_code=f"ERR_{i}",
            created_at=base + timedelta(seconds=i),
        )
    db_session.commit()

    body = failure_trend_client.get("/api/v1/runtime/failures/trend", params={"limit": 2}).json()
    assert body["total"] == 2
    assert len(body["buckets"]) == 2
    assert body["buckets"][0]["error_code"] == "ERR_4"
    assert body["buckets"][1]["error_code"] == "ERR_3"


def test_failure_trend_order_latest_created_at_desc(failure_trend_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    t_old = datetime(2026, 6, 5, 8, 0, 0, tzinfo=UTC)
    t_new = datetime(2026, 6, 5, 18, 0, 0, tzinfo=UTC)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_send_failed",
        error_code="OLDER",
        created_at=t_old,
    )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_b_id"],
        destination_id=h["dest_b_id"],
        stage="destination_rate_limited",
        error_code="NEWER",
        created_at=t_new,
    )
    db_session.commit()

    buckets = failure_trend_client.get("/api/v1/runtime/failures/trend").json()["buckets"]
    assert buckets[0]["error_code"] == "NEWER"
    assert buckets[1]["error_code"] == "OLDER"


def test_failure_trend_order_count_desc_tiebreak(failure_trend_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    t = datetime(2026, 6, 6, 9, 0, 0, tzinfo=UTC)
    for _ in range(3):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="route_send_failed",
            error_code="HIGH_COUNT",
            created_at=t,
        )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_b_id"],
        destination_id=h["dest_b_id"],
        stage="route_send_failed",
        error_code="LOW_COUNT",
        created_at=t,
    )
    db_session.commit()

    buckets = failure_trend_client.get("/api/v1/runtime/failures/trend").json()["buckets"]
    assert buckets[0]["error_code"] == "HIGH_COUNT"
    assert buckets[0]["count"] == 3
    assert buckets[1]["error_code"] == "LOW_COUNT"
    assert buckets[1]["count"] == 1


def test_failure_trend_payload_sample_not_in_response(
    failure_trend_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_send_failed",
        payload_sample={"x": "y"},
    )
    db_session.commit()

    raw = failure_trend_client.get("/api/v1/runtime/failures/trend").text
    assert "payload_sample" not in raw
    assert "secret" not in raw


def test_failure_trend_no_commit_or_rollback(
    monkeypatch: pytest.MonkeyPatch,
    failure_trend_client: TestClient,
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

    assert failure_trend_client.get("/api/v1/runtime/failures/trend").status_code == 200
    assert commit_calls["n"] == 0
    assert rollback_calls["n"] == 0


def test_failure_trend_limit_validation_422(failure_trend_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    db_session.commit()
    assert failure_trend_client.get("/api/v1/runtime/failures/trend", params={"limit": 0}).status_code == 422
    assert failure_trend_client.get("/api/v1/runtime/failures/trend", params={"limit": 10001}).status_code == 422
