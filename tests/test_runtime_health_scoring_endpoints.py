"""Runtime health scoring APIs — deterministic read-only operational scoring."""

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
from app.runtime import health_service
from app.runtime.health_schemas import HealthMetrics
from app.sources.models import Source
from app.streams.models import Stream

UTC = timezone.utc


def _seed_stream_two_routes(db: Session, *, stream_name: str = "hs-stream") -> dict[str, int]:
    connector = Connector(name=f"hs-connector-{stream_name}", description=None, status="RUNNING")
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
        name=stream_name,
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
        name=f"hs-d1-{stream_name}",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://a.example/h"},
        rate_limit_json={},
        enabled=True,
    )
    d2 = Destination(
        name=f"hs-d2-{stream_name}",
        destination_type="SYSLOG_TCP",
        config_json={"host": "syslog.example", "port": 514},
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
    retry_count: int = 0,
    latency_ms: int | None = None,
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
            payload_sample={"x": 1},
            retry_count=retry_count,
            http_status=None,
            latency_ms=latency_ms,
            error_code=error_code,
            created_at=created_at or datetime.now(UTC),
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


def _agg(
    *,
    failures: int = 0,
    successes: int = 0,
    retry_events: int = 0,
    retry_sum: int = 0,
    rate_limited: int = 0,
    latency_p95: float | None = None,
    last_failure: datetime | None = None,
    last_success: datetime | None = None,
) -> health_service._Aggregate:
    return health_service._Aggregate(
        failure_count=failures,
        success_count=successes,
        retry_event_count=retry_events,
        retry_count_sum=retry_sum,
        rate_limit_count=rate_limited,
        latency_ms_avg=None,
        latency_ms_p95=latency_p95,
        last_failure_at=last_failure,
        last_success_at=last_success,
    )


def test_compute_score_healthy_when_all_success() -> None:
    score = health_service.compute_health_score(
        _agg(successes=20),
        include_latency=True,
    )
    assert score.score == 100
    assert score.level == "HEALTHY"
    assert score.factors == []
    assert isinstance(score.metrics, HealthMetrics)


def test_compute_score_critical_when_only_failures() -> None:
    score = health_service.compute_health_score(
        _agg(failures=60),
        include_latency=False,
    )
    assert score.level == "CRITICAL"
    assert score.score < 40
    codes = {f.code for f in score.factors}
    assert "failure_rate" in codes
    assert "inactivity" in codes
    assert "repeated_failures" in codes


def test_compute_score_degraded_with_moderate_failure_rate() -> None:
    score = health_service.compute_health_score(
        _agg(failures=2, successes=18),
        include_latency=False,
    )
    assert 70 <= score.score < 90
    assert score.level == "DEGRADED"


def test_compute_score_unhealthy_with_high_failure_rate() -> None:
    score = health_service.compute_health_score(
        _agg(failures=4, successes=16),
        include_latency=False,
    )
    assert score.level in {"UNHEALTHY", "DEGRADED"}
    assert any(f.code == "failure_rate" for f in score.factors)


def test_compute_score_retry_heavy_penalizes_score() -> None:
    base = health_service.compute_health_score(
        _agg(failures=0, successes=20),
        include_latency=False,
    )
    retry_heavy = health_service.compute_health_score(
        _agg(failures=0, successes=10, retry_events=15, retry_sum=30),
        include_latency=False,
    )
    assert retry_heavy.score < base.score
    assert any(f.code == "retry_rate" for f in retry_heavy.factors)


def test_compute_score_clamped_to_zero_floor() -> None:
    score = health_service.compute_health_score(
        _agg(failures=200, retry_events=10, rate_limited=50),
        include_latency=True,
    )
    assert score.score == 0
    assert score.level == "CRITICAL"


def test_compute_score_latency_factor_for_routes() -> None:
    score = health_service.compute_health_score(
        _agg(successes=50, latency_p95=8000.0),
        include_latency=True,
    )
    assert any(f.code == "latency_p95" for f in score.factors)


def test_compute_score_latency_skipped_for_streams() -> None:
    score = health_service.compute_health_score(
        _agg(successes=50, latency_p95=8000.0),
        include_latency=False,
    )
    assert all(f.code != "latency_p95" for f in score.factors)


def test_overview_empty_logs_returns_healthy_zero_counts(
    health_client: TestClient, db_session: Session
) -> None:
    _seed_stream_two_routes(db_session)
    db_session.commit()
    body = health_client.get("/api/v1/runtime/health/overview").json()
    assert body["streams"]["healthy"] == 0
    assert body["routes"]["healthy"] == 0
    assert body["destinations"]["healthy"] == 0
    assert body["worst_routes"] == []
    assert body["worst_streams"] == []
    assert body["worst_destinations"] == []
    assert body["average_stream_score"] is None


def test_streams_endpoint_returns_healthy_for_recent_success(
    health_client: TestClient, db_session: Session
) -> None:
    h = _seed_stream_two_routes(db_session)
    t = datetime.now(UTC) - timedelta(minutes=5)
    for i in range(5):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="route_send_success",
            created_at=t + timedelta(seconds=i),
            latency_ms=80,
        )
    db_session.commit()
    body = health_client.get("/api/v1/runtime/health/streams").json()
    assert len(body["rows"]) == 1
    row = body["rows"][0]
    assert row["stream_id"] == h["stream_id"]
    assert row["score"] == 100
    assert row["level"] == "HEALTHY"
    assert row["metrics"]["failure_count"] == 0
    assert row["metrics"]["success_count"] == 5


def test_routes_endpoint_orders_unhealthy_first(
    health_client: TestClient, db_session: Session
) -> None:
    h = _seed_stream_two_routes(db_session)
    t = datetime.now(UTC) - timedelta(minutes=5)
    for i in range(10):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="route_send_failed",
            level="ERROR",
            status="FAILED",
            error_code="Timeout",
            created_at=t + timedelta(seconds=i),
            latency_ms=200,
        )
    for i in range(8):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_b_id"],
            destination_id=h["dest_b_id"],
            stage="route_send_success",
            created_at=t + timedelta(seconds=i),
            latency_ms=120,
        )
    db_session.commit()

    body = health_client.get("/api/v1/runtime/health/routes").json()
    rows = body["rows"]
    assert len(rows) == 2
    assert rows[0]["route_id"] == h["route_a_id"]
    assert rows[0]["score"] < rows[1]["score"]
    assert rows[0]["level"] in {"CRITICAL", "UNHEALTHY"}
    assert any(f["code"] == "failure_rate" for f in rows[0]["factors"])


def test_destinations_endpoint_returns_per_destination_rows(
    health_client: TestClient, db_session: Session
) -> None:
    h = _seed_stream_two_routes(db_session)
    t = datetime.now(UTC) - timedelta(minutes=5)
    for i in range(4):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="route_send_failed",
            level="ERROR",
            status="FAILED",
            created_at=t + timedelta(seconds=i),
        )
    for i in range(6):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_b_id"],
            destination_id=h["dest_b_id"],
            stage="route_send_success",
            created_at=t + timedelta(seconds=i),
        )
    db_session.commit()

    body = health_client.get("/api/v1/runtime/health/destinations").json()
    rows = body["rows"]
    assert {r["destination_id"] for r in rows} == {h["dest_a_id"], h["dest_b_id"]}
    bad = next(r for r in rows if r["destination_id"] == h["dest_a_id"])
    good = next(r for r in rows if r["destination_id"] == h["dest_b_id"])
    assert good["score"] > bad["score"]
    assert good["destination_name"] is not None


def test_stream_detail_returns_factors_and_metrics(
    health_client: TestClient, db_session: Session
) -> None:
    h = _seed_stream_two_routes(db_session)
    t = datetime.now(UTC) - timedelta(minutes=5)
    for i in range(3):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="route_retry_failed",
            level="ERROR",
            status="FAILED",
            retry_count=2,
            error_code="Timeout",
            created_at=t + timedelta(seconds=i),
        )
    db_session.commit()
    body = health_client.get(
        f"/api/v1/runtime/health/streams/{h['stream_id']}"
    ).json()
    assert body["stream_id"] == h["stream_id"]
    score = body["score"]
    assert score["level"] in {"CRITICAL", "UNHEALTHY", "DEGRADED"}
    assert score["metrics"]["failure_count"] == 3
    assert score["metrics"]["retry_event_count"] == 3
    codes = {f["code"] for f in score["factors"]}
    assert "inactivity" in codes


def test_route_detail_includes_latency_factor_when_high(
    health_client: TestClient, db_session: Session
) -> None:
    h = _seed_stream_two_routes(db_session)
    t = datetime.now(UTC) - timedelta(minutes=5)
    for i in range(8):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="route_send_success",
            created_at=t + timedelta(seconds=i),
            latency_ms=8000,
        )
    db_session.commit()
    body = health_client.get(
        f"/api/v1/runtime/health/routes/{h['route_a_id']}"
    ).json()
    assert body["route_id"] == h["route_a_id"]
    assert any(f["code"] == "latency_p95" for f in body["score"]["factors"])


def test_stream_detail_404_for_unknown_stream(
    health_client: TestClient, db_session: Session
) -> None:
    _seed_stream_two_routes(db_session)
    db_session.commit()
    r = health_client.get("/api/v1/runtime/health/streams/9999999")
    assert r.status_code == 404


def test_route_detail_404_for_unknown_route(
    health_client: TestClient, db_session: Session
) -> None:
    _seed_stream_two_routes(db_session)
    db_session.commit()
    r = health_client.get("/api/v1/runtime/health/routes/9999999")
    assert r.status_code == 404


def test_window_filter_excludes_old_failures(
    health_client: TestClient, db_session: Session
) -> None:
    h = _seed_stream_two_routes(db_session)
    old = datetime.now(UTC) - timedelta(hours=48)
    new = datetime.now(UTC) - timedelta(minutes=5)
    for i in range(20):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="route_send_failed",
            level="ERROR",
            status="FAILED",
            created_at=old + timedelta(seconds=i),
        )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_send_success",
        created_at=new,
    )
    db_session.commit()
    body = health_client.get(
        "/api/v1/runtime/health/streams",
        params={"window": "24h"},
    ).json()
    assert len(body["rows"]) == 1
    assert body["rows"][0]["score"] == 100


def test_filter_by_stream_id(
    health_client: TestClient, db_session: Session
) -> None:
    h1 = _seed_stream_two_routes(db_session, stream_name="hs-stream-a")
    h2 = _seed_stream_two_routes(db_session, stream_name="hs-stream-b")
    t = datetime.now(UTC) - timedelta(minutes=3)
    _log(
        db_session,
        connector_id=h1["connector_id"],
        stream_id=h1["stream_id"],
        route_id=h1["route_a_id"],
        destination_id=h1["dest_a_id"],
        stage="route_send_failed",
        level="ERROR",
        status="FAILED",
        created_at=t,
    )
    _log(
        db_session,
        connector_id=h2["connector_id"],
        stream_id=h2["stream_id"],
        route_id=h2["route_a_id"],
        destination_id=h2["dest_a_id"],
        stage="route_send_success",
        created_at=t,
    )
    db_session.commit()

    body = health_client.get(
        "/api/v1/runtime/health/streams",
        params={"stream_id": h1["stream_id"]},
    ).json()
    assert len(body["rows"]) == 1
    assert body["rows"][0]["stream_id"] == h1["stream_id"]


def test_health_endpoints_are_read_only_no_commit(
    health_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    h = _seed_stream_two_routes(db_session)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_send_failed",
        level="ERROR",
        status="FAILED",
        created_at=datetime.now(UTC) - timedelta(minutes=2),
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

    assert health_client.get("/api/v1/runtime/health/overview").status_code == 200
    assert health_client.get("/api/v1/runtime/health/streams").status_code == 200
    assert health_client.get("/api/v1/runtime/health/routes").status_code == 200
    assert health_client.get("/api/v1/runtime/health/destinations").status_code == 200
    assert health_client.get(
        f"/api/v1/runtime/health/streams/{h['stream_id']}"
    ).status_code == 200
    assert health_client.get(
        f"/api/v1/runtime/health/routes/{h['route_a_id']}"
    ).status_code == 200
    assert commit_calls["n"] == 0
    assert rollback_calls["n"] == 0


def test_overview_worst_lists_ordered_by_score_asc(
    health_client: TestClient, db_session: Session
) -> None:
    h1 = _seed_stream_two_routes(db_session, stream_name="hs-stream-w1")
    h2 = _seed_stream_two_routes(db_session, stream_name="hs-stream-w2")
    t = datetime.now(UTC) - timedelta(minutes=3)
    for _ in range(20):
        _log(
            db_session,
            connector_id=h1["connector_id"],
            stream_id=h1["stream_id"],
            route_id=h1["route_a_id"],
            destination_id=h1["dest_a_id"],
            stage="route_send_failed",
            level="ERROR",
            status="FAILED",
            created_at=t,
        )
    for _ in range(20):
        _log(
            db_session,
            connector_id=h2["connector_id"],
            stream_id=h2["stream_id"],
            route_id=h2["route_a_id"],
            destination_id=h2["dest_a_id"],
            stage="route_send_success",
            created_at=t,
        )
    db_session.commit()
    body = health_client.get("/api/v1/runtime/health/overview").json()
    worst_streams = body["worst_streams"]
    assert worst_streams[0]["stream_id"] == h1["stream_id"]
    assert worst_streams[0]["score"] < worst_streams[-1]["score"]
    assert body["streams"]["critical"] >= 1
    assert body["streams"]["healthy"] >= 1
