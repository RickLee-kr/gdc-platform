"""Runtime analytics APIs — read-only delivery_logs aggregates."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.database import get_db
from app.destinations.models import Destination
from app.logs.models import DeliveryLog
from app.main import app
from app.routes.models import Route
from app.runtime.snapshot_materialization import cleanup_expired_snapshots
from app.sources.models import Source
from app.streams.models import Stream

UTC = timezone.utc


def _seed_stream_two_routes(db: Session) -> dict[str, int]:
    connector = Connector(name="an-connector", description=None, status="RUNNING")
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
        name="an-stream",
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
        name="an-d1",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://a.example/h"},
        rate_limit_json={},
        enabled=True,
    )
    d2 = Destination(
        name="an-d2",
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
    retry_count: int = 0,
    latency_ms: int | None = None,
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
            payload_sample=payload_sample or {"x": 1},
            retry_count=retry_count,
            http_status=None,
            latency_ms=latency_ms,
            error_code=error_code,
            created_at=created_at or datetime(2026, 6, 1, 10, 0, 0, tzinfo=UTC),
        )
    )


@pytest.fixture
def analytics_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_analytics_route_failures_summary(analytics_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    t = datetime.now(UTC) - timedelta(minutes=5)
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
        created_at=t,
    )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_send_success",
        created_at=t + timedelta(seconds=1),
        latency_ms=100,
    )
    db_session.commit()

    r = analytics_client.get("/api/v1/runtime/analytics/routes/failures", params={"window": "24h"})
    assert r.status_code == 200
    body = r.json()
    assert body["totals"]["failure_events"] == 1
    assert body["totals"]["success_events"] == 1
    assert body["totals"]["failure_events"] + body["totals"]["success_events"] == 2
    assert body["totals"]["overall_failure_rate"] == pytest.approx(0.5)
    assert len(body["outcomes_by_route"]) >= 1
    row = next(x for x in body["outcomes_by_route"] if x["route_id"] == h["route_a_id"])
    assert row["failure_count"] == 1
    assert row["success_count"] == 1


def test_delivery_outcomes_use_event_count_and_retry_success(
    analytics_client: TestClient, db_session: Session
) -> None:
    h = _seed_stream_two_routes(db_session)
    t = datetime.now(UTC) - timedelta(minutes=3)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_send_success",
        created_at=t,
        payload_sample={"event_count": 24},
    )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_retry_success",
        created_at=t + timedelta(seconds=1),
        payload_sample={"event_count": 6},
    )
    db_session.commit()

    failures = analytics_client.get("/api/v1/runtime/analytics/routes/failures", params={"window": "24h"}).json()
    by_dest = analytics_client.get(
        "/api/v1/runtime/analytics/delivery-outcomes/destinations",
        params={"window": "24h"},
    ).json()

    assert failures["totals"]["success_events"] == 30
    row = next(x for x in by_dest["rows"] if x["destination_id"] == h["dest_a_id"])
    assert row["success_events"] == 30
    assert row["failure_events"] == 0


def test_analytics_route_aggregation_two_routes(analytics_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    t = datetime.now(UTC) - timedelta(minutes=2)
    for rid, did in ((h["route_a_id"], h["dest_a_id"]), (h["route_b_id"], h["dest_b_id"])):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=rid,
            destination_id=did,
            stage="route_send_failed",
            level="ERROR",
            status="FAILED",
            error_code="E1",
            created_at=t,
        )
    db_session.commit()

    body = analytics_client.get("/api/v1/runtime/analytics/routes/failures").json()
    assert body["totals"]["failure_events"] == 2
    dest_counts = {x["id"]: x["failure_count"] for x in body["failures_by_destination"]}
    assert dest_counts.get(h["dest_a_id"]) == 1
    assert dest_counts.get(h["dest_b_id"]) == 1


def test_analytics_retry_aggregation(analytics_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    t = datetime.now(UTC) - timedelta(minutes=1)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_retry_success",
        retry_count=2,
        created_at=t,
        latency_ms=50,
    )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_retry_failed",
        level="ERROR",
        status="FAILED",
        retry_count=3,
        error_code="Timeout",
        created_at=t + timedelta(seconds=1),
    )
    db_session.commit()

    summary = analytics_client.get("/api/v1/runtime/analytics/retries/summary").json()
    assert summary["retry_success_events"] == 1
    assert summary["retry_failed_events"] == 1
    assert summary["total_retry_outcome_events"] == 2
    assert summary["retry_column_sum"] == 5

    streams = analytics_client.get("/api/v1/runtime/analytics/streams/retries").json()
    assert streams["retry_heavy_streams"][0]["stream_id"] == h["stream_id"]
    assert streams["retry_heavy_streams"][0]["retry_event_count"] == 2


def test_analytics_empty_logs(analytics_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    db_session.commit()
    body = analytics_client.get("/api/v1/runtime/analytics/routes/failures").json()
    assert body["totals"]["failure_events"] == 0
    assert body["totals"]["success_events"] == 0
    assert body["failure_trend"]
    assert all(bucket["failure_count"] == 0 for bucket in body["failure_trend"])
    assert body["visualization_meta"]["analytics.delivery_failures.bucket_histogram"]["cumulative_semantics"] == "histogram_not_cumulative"
    assert body["unstable_routes"] == []


def test_analytics_filter_stream_id(analytics_client: TestClient, db_session: Session) -> None:
    h1 = _seed_stream_two_routes(db_session)
    h2 = _seed_stream_two_routes(db_session)
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
        stage="route_send_failed",
        level="ERROR",
        status="FAILED",
        created_at=t,
    )
    db_session.commit()

    b = analytics_client.get(
        "/api/v1/runtime/analytics/routes/failures",
        params={"stream_id": h1["stream_id"]},
    ).json()
    assert b["totals"]["failure_events"] == 1


def test_analytics_scoped_route_not_found(analytics_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    db_session.commit()
    r = analytics_client.get("/api/v1/runtime/analytics/routes/999999/failures")
    assert r.status_code == 404


def test_explain_stream_scoped_failure_count_uses_logs_stream_created_index(
    db_session: Session,
) -> None:
    """EXPLAIN should be able to use idx_logs_stream_id_created_at for stream + time + stage (011).

    Bulk inserts leave statistics stale; ANALYZE refreshes them. ``SET LOCAL enable_seqscan = OFF``
    in the same transaction as EXPLAIN keeps the plan deterministic when row counts sit near
    the planner's seq-scan vs index threshold.
    """

    h = _seed_stream_two_routes(db_session)
    t = datetime.now(UTC) - timedelta(minutes=5)
    base = datetime.now(UTC) - timedelta(days=200)
    noise = [
        {
            "connector_id": h["connector_id"],
            "stream_id": h["stream_id"],
            "route_id": h["route_a_id"],
            "destination_id": h["dest_a_id"],
            "stage": "route_send_success",
            "level": "INFO",
            "status": "OK",
            "message": "noise",
            "payload_sample": {},
            "retry_count": 0,
            "http_status": None,
            "latency_ms": None,
            "error_code": None,
            "created_at": base + timedelta(seconds=i),
        }
        for i in range(1200)
    ]
    db_session.bulk_insert_mappings(DeliveryLog, noise)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_send_failed",
        level="ERROR",
        status="FAILED",
        created_at=t,
    )
    db_session.commit()
    since = t - timedelta(hours=1)
    until = datetime.now(UTC) + timedelta(minutes=1)
    sql = text(
        """
        EXPLAIN (FORMAT TEXT)
        SELECT COUNT(*)::bigint AS c
        FROM delivery_logs
        WHERE stream_id = :sid
          AND created_at >= :since
          AND created_at <= :until
          AND stage IN ('route_send_failed', 'route_retry_failed', 'route_unknown_failure_policy')
        """
    )
    bind = db_session.get_bind()
    with bind.connect() as conn:
        conn.execute(text("ANALYZE delivery_logs"))
        conn.commit()
    params = {"sid": h["stream_id"], "since": since, "until": until}
    with bind.connect() as conn:
        with conn.begin():
            conn.execute(text("SET LOCAL enable_seqscan = OFF"))
            raw = conn.execute(sql, params).fetchall()
    lines = [str(row[0]) for row in raw]
    plan = "\n".join(lines)
    assert "Index" in plan
    assert "delivery_logs_2026_05" in plan
    assert "delivery_logs_default" not in plan


def test_analytics_stable_with_many_rows_outside_window(analytics_client: TestClient, db_session: Session) -> None:
    """Large noise volume outside the analytics window must not change window totals."""

    h = _seed_stream_two_routes(db_session)
    fresh = datetime.now(UTC) - timedelta(minutes=2)
    stale = datetime.now(UTC) - timedelta(days=400)
    for i in range(400):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="route_send_success",
            created_at=stale + timedelta(seconds=i),
        )
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_send_failed",
        level="ERROR",
        status="FAILED",
        created_at=fresh,
    )
    db_session.commit()

    body = analytics_client.get("/api/v1/runtime/analytics/routes/failures", params={"window": "24h"}).json()
    assert body["totals"]["failure_events"] == 1


def test_analytics_no_db_commit(analytics_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
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

    assert analytics_client.get("/api/v1/runtime/analytics/routes/failures").status_code == 200
    assert analytics_client.get("/api/v1/runtime/analytics/retries/summary").status_code == 200
    assert commit_calls["n"] == 0
    assert rollback_calls["n"] == 0


def test_historical_analytics_snapshot_stays_stable_after_log_retention(
    analytics_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    snapshot_at = datetime.now(UTC).replace(microsecond=0)
    event_at = snapshot_at - timedelta(minutes=5)
    _log(
        db_session,
        connector_id=h["connector_id"],
        stream_id=h["stream_id"],
        route_id=h["route_a_id"],
        destination_id=h["dest_a_id"],
        stage="route_send_success",
        created_at=event_at,
        payload_sample={"event_count": 9},
    )
    db_session.commit()

    params = {"window": "1h", "snapshot_id": snapshot_at.isoformat()}
    first = analytics_client.get("/api/v1/runtime/analytics/routes/failures", params=params).json()
    assert first["totals"]["success_events"] == 9

    db_session.query(DeliveryLog).filter(DeliveryLog.connector_id == h["connector_id"]).delete(synchronize_session=False)
    db_session.commit()
    cleanup_expired_snapshots(db_session, now=snapshot_at + timedelta(days=1))
    db_session.commit()

    second = analytics_client.get("/api/v1/runtime/analytics/routes/failures", params=params).json()
    assert second["time"]["snapshot_id"] == first["time"]["snapshot_id"]
    assert second["time"]["window_start"] == first["time"]["window_start"]
    assert second["time"]["window_end"] == first["time"]["window_end"]
    assert second["totals"]["success_events"] == first["totals"]["success_events"]

