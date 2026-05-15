"""Runtime stream stats API — read-only aggregation from delivery_logs and checkpoints."""

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


def _seed_stream_two_routes(
    db: Session,
) -> dict[str, Any]:
    connector = Connector(name="stats-connector", description=None, status="RUNNING")
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
        name="stats-stream",
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
        name="stats-dest-a",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://a.example/hook"},
        rate_limit_json={},
        enabled=True,
    )
    dest_b = Destination(
        name="stats-dest-b",
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
        enabled=True,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    route_b = Route(
        stream_id=stream.id,
        destination_id=dest_b.id,
        enabled=True,
        failure_policy="RETRY_AND_BACKOFF",
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    db.add_all([route_a, route_b])
    db.flush()

    checkpoint = Checkpoint(
        stream_id=stream.id,
        checkpoint_type="EVENT_ID",
        checkpoint_value_json={"last_success_event": {"event_id": "evt-1"}},
    )
    db.add(checkpoint)
    db.commit()
    db.refresh(stream)
    db.refresh(route_a)
    db.refresh(route_b)
    db.refresh(dest_a)
    db.refresh(dest_b)

    return {
        "connector_id": connector.id,
        "stream_id": stream.id,
        "route_a_id": route_a.id,
        "route_b_id": route_b.id,
        "dest_a_id": dest_a.id,
        "dest_b_id": dest_b.id,
    }


def _add_log(
    db: Session,
    *,
    connector_id: int,
    stream_id: int,
    route_id: int | None,
    destination_id: int | None,
    stage: str,
    created_at: datetime,
    message: str = "x",
    status: str | None = "OK",
    level: str = "INFO",
    error_code: str | None = None,
) -> None:
    row = DeliveryLog(
        connector_id=connector_id,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        stage=stage,
        level=level,
        status=status,
        message=message,
        payload_sample={"secret": "do-not-expose"},
        retry_count=0,
        http_status=None,
        latency_ms=None,
        error_code=error_code,
        created_at=created_at,
    )
    db.add(row)


@pytest.fixture
def stats_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_stats_health_bundle_matches_separate_endpoints(stats_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_two_routes(db_session)
    sid = seeded["stream_id"]
    cid = seeded["connector_id"]
    r1 = seeded["route_a_id"]
    d1 = seeded["dest_a_id"]
    t0 = datetime(2026, 5, 6, 10, 0, 0, tzinfo=UTC)
    _add_log(
        db_session,
        connector_id=cid,
        stream_id=sid,
        route_id=r1,
        destination_id=d1,
        stage="route_send_success",
        created_at=t0,
        message="ok",
    )
    db_session.commit()

    lim = 80
    stats_only = stats_client.get(f"/api/v1/runtime/stats/stream/{sid}", params={"limit": lim}).json()
    health_only = stats_client.get(f"/api/v1/runtime/health/stream/{sid}", params={"limit": lim}).json()
    bundle = stats_client.get(f"/api/v1/runtime/streams/{sid}/stats-health", params={"limit": lim}).json()

    assert stats_client.get(f"/api/v1/runtime/streams/{sid}/stats-health").status_code == 200
    assert bundle["stats"] == stats_only
    assert bundle["health"] == health_only


def test_stream_stats_success_shape_and_checkpoint(stats_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_two_routes(db_session)

    t0 = datetime(2026, 5, 6, 10, 0, 0, tzinfo=UTC)
    _add_log(
        db_session,
        connector_id=seeded["connector_id"],
        stream_id=seeded["stream_id"],
        route_id=seeded["route_a_id"],
        destination_id=seeded["dest_a_id"],
        stage="route_send_success",
        created_at=t0,
        message="ok",
    )
    db_session.commit()

    response = stats_client.get(f"/api/v1/runtime/stats/stream/{seeded['stream_id']}")
    assert response.status_code == 200
    body = response.json()
    assert body["stream_id"] == seeded["stream_id"]
    assert body["stream_status"] == "RUNNING"
    assert body["checkpoint"] is not None
    assert body["checkpoint"]["type"] == "EVENT_ID"
    assert body["checkpoint"]["value"]["last_success_event"]["event_id"] == "evt-1"
    assert "payload_sample" not in str(body)


def test_summary_stage_counts_accuracy(stats_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_two_routes(db_session)
    cid = seeded["connector_id"]
    sid = seeded["stream_id"]
    r1 = seeded["route_a_id"]
    r2 = seeded["route_b_id"]
    d1 = seeded["dest_a_id"]
    d2 = seeded["dest_b_id"]

    base = datetime(2026, 5, 6, 12, 0, 0, tzinfo=UTC)
    _add_log(db_session, connector_id=cid, stream_id=sid, route_id=r1, destination_id=d1, stage="route_send_success", created_at=base)
    _add_log(db_session, connector_id=cid, stream_id=sid, route_id=r1, destination_id=d1, stage="route_send_failed", created_at=base)
    _add_log(db_session, connector_id=cid, stream_id=sid, route_id=r2, destination_id=d2, stage="route_retry_success", created_at=base)
    _add_log(db_session, connector_id=cid, stream_id=sid, route_id=r2, destination_id=d2, stage="route_retry_failed", created_at=base)
    _add_log(db_session, connector_id=cid, stream_id=sid, route_id=r1, destination_id=d1, stage="route_skip", created_at=base)
    _add_log(db_session, connector_id=cid, stream_id=sid, route_id=None, destination_id=None, stage="source_rate_limited", created_at=base)
    _add_log(db_session, connector_id=cid, stream_id=sid, route_id=r2, destination_id=d2, stage="destination_rate_limited", created_at=base)
    _add_log(db_session, connector_id=cid, stream_id=sid, route_id=r1, destination_id=d1, stage="route_unknown_failure_policy", created_at=base)
    _add_log(db_session, connector_id=cid, stream_id=sid, route_id=None, destination_id=None, stage="run_complete", created_at=base)
    db_session.commit()

    response = stats_client.get(f"/api/v1/runtime/stats/stream/{sid}")
    assert response.status_code == 200
    s = response.json()["summary"]
    assert s["total_logs"] == 9
    assert s["route_send_success"] == 1
    assert s["route_send_failed"] == 1
    assert s["route_retry_success"] == 1
    assert s["route_retry_failed"] == 1
    assert s["route_skip"] == 1
    assert s["source_rate_limited"] == 1
    assert s["destination_rate_limited"] == 1
    assert s["route_unknown_failure_policy"] == 1
    assert s["run_complete"] == 1


def test_route_level_counts_and_destination_metadata(stats_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_two_routes(db_session)
    cid = seeded["connector_id"]
    sid = seeded["stream_id"]
    r1 = seeded["route_a_id"]
    r2 = seeded["route_b_id"]
    d1 = seeded["dest_a_id"]
    d2 = seeded["dest_b_id"]

    t = datetime(2026, 5, 6, 15, 0, 0, tzinfo=UTC)
    _add_log(db_session, connector_id=cid, stream_id=sid, route_id=r1, destination_id=d1, stage="route_send_success", created_at=t)
    _add_log(db_session, connector_id=cid, stream_id=sid, route_id=r1, destination_id=d1, stage="route_send_failed", created_at=t)
    _add_log(db_session, connector_id=cid, stream_id=sid, route_id=r1, destination_id=d1, stage="destination_rate_limited", created_at=t)
    _add_log(db_session, connector_id=cid, stream_id=sid, route_id=r2, destination_id=d2, stage="route_retry_success", created_at=t)
    db_session.commit()

    response = stats_client.get(f"/api/v1/runtime/stats/stream/{sid}")
    routes = {r["route_id"]: r for r in response.json()["routes"]}
    assert routes[r1]["destination_id"] == d1
    assert routes[r1]["destination_type"] == "WEBHOOK_POST"
    assert routes[r1]["enabled"] is True
    assert routes[r1]["failure_policy"] == "LOG_AND_CONTINUE"
    assert routes[r1]["status"] == "ENABLED"
    assert routes[r1]["counts"]["route_send_success"] == 1
    assert routes[r1]["counts"]["route_send_failed"] == 1
    assert routes[r1]["counts"]["destination_rate_limited"] == 1

    assert routes[r2]["destination_type"] == "SYSLOG_UDP"
    assert routes[r2]["counts"]["route_retry_success"] == 1


def test_last_seen_timestamps(stats_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_two_routes(db_session)
    cid = seeded["connector_id"]
    sid = seeded["stream_id"]
    r1 = seeded["route_a_id"]
    d1 = seeded["dest_a_id"]

    t_succ_a = datetime(2026, 5, 6, 9, 0, 0, tzinfo=UTC)
    t_succ_b = datetime(2026, 5, 6, 9, 30, 0, tzinfo=UTC)
    t_fail = datetime(2026, 5, 6, 10, 0, 0, tzinfo=UTC)
    t_rl = datetime(2026, 5, 6, 11, 0, 0, tzinfo=UTC)

    _add_log(db_session, connector_id=cid, stream_id=sid, route_id=r1, destination_id=d1, stage="route_send_success", created_at=t_succ_a)
    _add_log(db_session, connector_id=cid, stream_id=sid, route_id=r1, destination_id=d1, stage="route_retry_success", created_at=t_succ_b)
    _add_log(db_session, connector_id=cid, stream_id=sid, route_id=r1, destination_id=d1, stage="route_send_failed", created_at=t_fail)
    _add_log(db_session, connector_id=cid, stream_id=sid, route_id=None, destination_id=None, stage="source_rate_limited", created_at=t_rl)
    db_session.commit()

    body = stats_client.get(f"/api/v1/runtime/stats/stream/{sid}").json()
    ls = body["last_seen"]
    assert ls["success_at"] is not None and "2026-05-06T09:30:00" in ls["success_at"]
    assert "2026-05-06T10:00:00" in ls["failure_at"]
    assert "2026-05-06T11:00:00" in ls["rate_limited_at"]

    routes = {r["route_id"]: r for r in body["routes"]}
    assert "2026-05-06T09:30:00" in routes[r1]["last_success_at"]
    assert "2026-05-06T10:00:00" in routes[r1]["last_failure_at"]


def test_recent_logs_respects_limit(stats_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_two_routes(db_session)
    cid = seeded["connector_id"]
    sid = seeded["stream_id"]
    r1 = seeded["route_a_id"]
    d1 = seeded["dest_a_id"]

    for i in range(5):
        _add_log(
            db_session,
            connector_id=cid,
            stream_id=sid,
            route_id=r1,
            destination_id=d1,
            stage="run_complete",
            created_at=datetime(2026, 5, 6, 8, i, 0, tzinfo=UTC),
            message=f"m{i}",
        )
    db_session.commit()

    body = stats_client.get(f"/api/v1/runtime/stats/stream/{sid}", params={"limit": 2}).json()
    assert len(body["recent_logs"]) == 2
    assert body["summary"]["total_logs"] == 2
    messages = {row["message"] for row in body["recent_logs"]}
    assert messages == {"m4", "m3"}
    for row in body["recent_logs"]:
        assert "payload_sample" not in row


def test_stream_not_found(stats_client: TestClient, db_session: Session) -> None:
    _seed_stream_two_routes(db_session)
    response = stats_client.get("/api/v1/runtime/stats/stream/999999")
    assert response.status_code == 404
    assert response.json()["detail"]["error_code"] == "STREAM_NOT_FOUND"


def test_endpoint_does_not_commit(
    monkeypatch: pytest.MonkeyPatch,
    stats_client: TestClient,
    db_session: Session,
) -> None:
    seeded = _seed_stream_two_routes(db_session)
    _add_log(
        db_session,
        connector_id=seeded["connector_id"],
        stream_id=seeded["stream_id"],
        route_id=seeded["route_a_id"],
        destination_id=seeded["dest_a_id"],
        stage="run_complete",
        created_at=datetime(2026, 5, 6, 7, 0, 0, tzinfo=UTC),
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

    response = stats_client.get(f"/api/v1/runtime/stats/stream/{seeded['stream_id']}")
    assert response.status_code == 200
    assert commit_calls["n"] == 0
    assert rollback_calls["n"] == 0


def test_endpoint_does_not_insert_delivery_logs(stats_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_two_routes(db_session)
    _add_log(
        db_session,
        connector_id=seeded["connector_id"],
        stream_id=seeded["stream_id"],
        route_id=seeded["route_a_id"],
        destination_id=seeded["dest_a_id"],
        stage="run_complete",
        created_at=datetime(2026, 5, 6, 6, 0, 0, tzinfo=UTC),
    )
    db_session.commit()

    before = db_session.query(DeliveryLog).filter(DeliveryLog.stream_id == seeded["stream_id"]).count()
    response = stats_client.get(f"/api/v1/runtime/stats/stream/{seeded['stream_id']}")
    assert response.status_code == 200
    after = db_session.query(DeliveryLog).filter(DeliveryLog.stream_id == seeded["stream_id"]).count()
    assert after == before


def test_limit_validation_rejected(stats_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_two_routes(db_session)
    res_low = stats_client.get(f"/api/v1/runtime/stats/stream/{seeded['stream_id']}", params={"limit": 0})
    assert res_low.status_code == 422
    res_high = stats_client.get(f"/api/v1/runtime/stats/stream/{seeded['stream_id']}", params={"limit": 2000})
    assert res_high.status_code == 422
