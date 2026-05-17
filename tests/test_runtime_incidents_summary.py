"""Runtime incidents summary aligned with current_runtime health posture."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.dev_validation_lab.seeder import _health_scoring_exclude_config
from app.validation.alert_service import apply_validation_alert_cycle
from app.validation.models import ContinuousValidation, ValidationAlert
from app.validation.ops_read import build_validation_operational_summary
from app.validation.runtime_incidents import build_current_runtime_operational_incidents
from tests.test_health_scoring_recovery import _log, _seed_stream_two_routes, health_client

UTC = timezone.utc


def test_current_runtime_incidents_excludes_recovered_and_lab_streams(
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session, stream_name="inc-live")
    sid = h["stream_id"]
    rid = h["route_a_id"]
    did = h["dest_a_id"]

    old = datetime.now(UTC) - timedelta(hours=20)
    recent = datetime.now(UTC) - timedelta(minutes=5)
    for i in range(6):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=sid,
            route_id=rid,
            destination_id=did,
            stage="route_send_failed",
            created_at=old + timedelta(seconds=i),
        )
    for i in range(10):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=sid,
            route_id=rid,
            destination_id=did,
            stage="route_send_success",
            created_at=recent + timedelta(seconds=i),
        )

    from app.streams.models import Stream

    lab = db_session.query(Stream).filter(Stream.id == sid).first()
    assert lab is not None
    lab.config_json = _health_scoring_exclude_config(dict(lab.config_json or {}))
    db_session.add(lab)

    v_fail = ContinuousValidation(
        name="auth-stale",
        enabled=True,
        validation_type="AUTH_ONLY",
        target_stream_id=sid,
        schedule_seconds=300,
        expect_checkpoint_advance=False,
        last_status="FAILING",
        consecutive_failures=2,
    )
    v_ok = ContinuousValidation(
        name="auth-recovered",
        enabled=True,
        validation_type="AUTH_ONLY",
        target_stream_id=sid,
        schedule_seconds=300,
        expect_checkpoint_advance=False,
        last_status="HEALTHY",
        consecutive_failures=0,
    )
    db_session.add_all([v_fail, v_ok])
    db_session.flush()

    apply_validation_alert_cycle(
        db_session,
        validation=v_fail,
        prev_last_status="FAILING",
        overall="FAIL",
        messages=["auth fail"],
        stats={},
        summary={"outcome": "source_fetch_failed", "message": "401", "transaction_committed": False, "run_id": None},
        had_auth_failure=True,
        had_checkpoint_drift=False,
        validation_run_id=None,
        latency_ms=1,
    )
    apply_validation_alert_cycle(
        db_session,
        validation=v_ok,
        prev_last_status="FAILING",
        overall="PASS",
        messages=[],
        stats={},
        summary={"outcome": "ok", "message": "ok", "transaction_committed": True, "run_id": None},
        had_auth_failure=False,
        had_checkpoint_drift=False,
        validation_run_id=None,
        latency_ms=1,
    )
    db_session.commit()

    live = build_current_runtime_operational_incidents(db_session, window="24h", failures_limit=20)
    hist = build_validation_operational_summary(
        db_session, failures_limit=20, scoring_mode="historical_analytics", window="24h"
    )

    assert live["open_delivery_failure_alerts"] == 0
    assert live["open_auth_failure_alerts"] == 0
    assert live["open_checkpoint_drift_alerts"] == 0
    assert hist["open_auth_failure_alerts"] >= 1


def test_dashboard_validation_operational_uses_current_runtime(
    health_client: TestClient, db_session: Session
) -> None:
    h = _seed_stream_two_routes(db_session, stream_name="inc-dash")
    recent = datetime.now(UTC) - timedelta(minutes=4)
    for i in range(8):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="route_send_success",
            created_at=recent + timedelta(seconds=i),
        )
    db_session.commit()

    dash = health_client.get("/api/v1/runtime/dashboard/summary", params={"window": "24h", "limit": 50}).json()
    vo = dash["validation_operational"]
    overview = health_client.get(
        "/api/v1/runtime/health/overview", params={"window": "24h", "scoring_mode": "current_runtime"}
    ).json()

    assert vo["open_delivery_failure_alerts"] == 0
    assert overview["streams"]["critical"] == 0
    assert overview["streams"]["healthy"] >= 1


def test_operational_summary_endpoint_scoring_mode_query(health_client: TestClient) -> None:
    cur = health_client.get(
        "/api/v1/runtime/validation/operational-summary",
        params={"scoring_mode": "current_runtime", "window": "1h"},
    )
    assert cur.status_code == 200
    hist = health_client.get(
        "/api/v1/runtime/validation/operational-summary",
        params={"scoring_mode": "historical_analytics", "window": "1h"},
    )
    assert hist.status_code == 200
