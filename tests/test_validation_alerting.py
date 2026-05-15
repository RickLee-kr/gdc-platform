"""Continuous validation alerting, dedupe, recovery, and notification payloads."""

from __future__ import annotations

from datetime import timedelta
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.database import get_db, utcnow
from app.main import app
from app.destinations.models import Destination
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream
from app.validation.alert_service import apply_validation_alert_cycle, build_failures_summary
from app.validation.models import ContinuousValidation, ValidationAlert
from app.validation.notifiers import slack as slack_notifier
from app.validation.notifiers.base import build_notification_payload
from app.validation.notifiers import pagerduty as pd_notifier


def _mk_stream_hierarchy(db: Session) -> int:
    connector = Connector(name="valert-conn", description=None, status="RUNNING")
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
        name="valert-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db.add(stream)
    db.flush()
    destination = Destination(
        name="valert-dest",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://example.invalid/hook"},
        rate_limit_json={},
        enabled=True,
    )
    db.add(destination)
    db.flush()
    route = Route(
        stream_id=stream.id,
        destination_id=destination.id,
        enabled=True,
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
    return int(stream.id)


@pytest.fixture
def client(db_session: Session) -> Any:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        with TestClient(app) as tc:
            yield tc
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_auth_failure_opens_critical_alert(db_session: Session) -> None:
    sid = _mk_stream_hierarchy(db_session)
    v = ContinuousValidation(
        name="auth-probe",
        enabled=True,
        validation_type="AUTH_ONLY",
        target_stream_id=sid,
        schedule_seconds=300,
        expect_checkpoint_advance=False,
        last_status="HEALTHY",
        consecutive_failures=0,
    )
    db_session.add(v)
    db_session.commit()
    db_session.refresh(v)

    apply_validation_alert_cycle(
        db_session,
        validation=v,
        prev_last_status="HEALTHY",
        overall="FAIL",
        messages=["401"],
        stats={},
        summary={"outcome": "source_fetch_failed", "message": "401", "transaction_committed": False, "run_id": None},
        had_auth_failure=True,
        had_checkpoint_drift=False,
        validation_run_id=None,
        latency_ms=10,
    )
    db_session.commit()

    rows = db_session.query(ValidationAlert).filter(ValidationAlert.validation_id == v.id).all()
    assert any(r.alert_type == "AUTH_FAILURE" and r.severity == "CRITICAL" and r.status == "OPEN" for r in rows)


def test_warn_escalation_caps_critical(db_session: Session) -> None:
    sid = _mk_stream_hierarchy(db_session)
    v = ContinuousValidation(
        name="warn-probe",
        enabled=True,
        validation_type="FETCH_ONLY",
        target_stream_id=sid,
        schedule_seconds=300,
        expect_checkpoint_advance=False,
        last_status="HEALTHY",
        consecutive_failures=0,
    )
    db_session.add(v)
    db_session.commit()
    db_session.refresh(v)

    apply_validation_alert_cycle(
        db_session,
        validation=v,
        prev_last_status="HEALTHY",
        overall="WARN",
        messages=["fetch committed but zero events extracted"],
        stats={},
        summary={"outcome": "no_events", "transaction_committed": True, "run_id": "abc"},
        had_auth_failure=False,
        had_checkpoint_drift=False,
        validation_run_id=None,
        latency_ms=5,
    )
    db_session.commit()
    crit = [r for r in db_session.query(ValidationAlert).filter(ValidationAlert.validation_id == v.id).all() if r.severity == "CRITICAL"]
    assert not crit


def test_repeated_auth_failures_deduplicate_fingerprint(db_session: Session) -> None:
    sid = _mk_stream_hierarchy(db_session)
    v = ContinuousValidation(
        name="dedupe",
        enabled=True,
        validation_type="AUTH_ONLY",
        target_stream_id=sid,
        schedule_seconds=300,
        expect_checkpoint_advance=False,
        last_status="HEALTHY",
        consecutive_failures=2,
    )
    db_session.add(v)
    db_session.commit()
    db_session.refresh(v)

    for _ in range(3):
        apply_validation_alert_cycle(
            db_session,
            validation=v,
            prev_last_status="DEGRADED",
            overall="FAIL",
            messages=["401"],
            stats={},
            summary={"outcome": "source_fetch_failed", "message": "401", "transaction_committed": False, "run_id": None},
            had_auth_failure=True,
            had_checkpoint_drift=False,
            validation_run_id=None,
            latency_ms=3,
        )
        db_session.commit()

    n = db_session.query(ValidationAlert).filter(ValidationAlert.validation_id == v.id, ValidationAlert.alert_type == "AUTH_FAILURE").count()
    assert n == 1


def test_recovery_pass_resolves_open_alerts(db_session: Session) -> None:
    sid = _mk_stream_hierarchy(db_session)
    v = ContinuousValidation(
        name="recover",
        enabled=True,
        validation_type="AUTH_ONLY",
        target_stream_id=sid,
        schedule_seconds=300,
        expect_checkpoint_advance=False,
        last_status="FAILING",
        consecutive_failures=0,
    )
    db_session.add(v)
    db_session.commit()
    db_session.refresh(v)

    apply_validation_alert_cycle(
        db_session,
        validation=v,
        prev_last_status="FAILING",
        overall="FAIL",
        messages=["401"],
        stats={},
        summary={"outcome": "source_fetch_failed", "message": "401", "transaction_committed": False, "run_id": None},
        had_auth_failure=True,
        had_checkpoint_drift=False,
        validation_run_id=None,
        latency_ms=2,
    )
    db_session.commit()
    assert db_session.query(ValidationAlert).filter(ValidationAlert.status == "OPEN").count() >= 1

    apply_validation_alert_cycle(
        db_session,
        validation=v,
        prev_last_status="FAILING",
        overall="PASS",
        messages=["ok"],
        stats={},
        summary={"outcome": "completed", "transaction_committed": True, "run_id": "r1"},
        had_auth_failure=False,
        had_checkpoint_drift=False,
        validation_run_id=None,
        latency_ms=2,
    )
    db_session.commit()
    assert db_session.query(ValidationAlert).filter(ValidationAlert.validation_id == v.id, ValidationAlert.status == "OPEN").count() == 0


def test_checkpoint_drift_alert(db_session: Session) -> None:
    sid = _mk_stream_hierarchy(db_session)
    v = ContinuousValidation(
        name="cp",
        enabled=True,
        validation_type="FULL_RUNTIME",
        target_stream_id=sid,
        schedule_seconds=300,
        expect_checkpoint_advance=True,
        last_status="HEALTHY",
        consecutive_failures=0,
    )
    db_session.add(v)
    db_session.commit()
    db_session.refresh(v)

    apply_validation_alert_cycle(
        db_session,
        validation=v,
        prev_last_status="HEALTHY",
        overall="FAIL",
        messages=["checkpoint drift: events delivered but checkpoint_updated is false"],
        stats={"route_send_success": 1, "route_send_failed": 0, "route_retry_failed": 0, "run_complete": 1},
        summary={"outcome": "completed", "transaction_committed": True, "run_id": "x"},
        had_auth_failure=False,
        had_checkpoint_drift=True,
        validation_run_id=None,
        latency_ms=4,
    )
    db_session.commit()
    rows = db_session.query(ValidationAlert).filter(ValidationAlert.validation_id == v.id).all()
    assert any(r.alert_type == "CHECKPOINT_DRIFT" for r in rows)


def test_slack_payload_generation() -> None:
    p = build_notification_payload(
        event_kind="validation_alert_opened",
        validation_id=7,
        validation_name="n",
        validation_type="FULL_RUNTIME",
        stream_id=3,
        stream_name="s",
        connector_name="c",
        severity="CRITICAL",
        alert_type="AUTH_FAILURE",
        last_error="401",
        consecutive_failures=2,
        run_id="rid",
        validation_run_id=99,
        message="boom",
        route_id=12,
    )
    body = slack_notifier.body_for_slack_webhook(p)
    assert "text" in body
    assert "FULL_RUNTIME" in body["text"]


def test_pagerduty_payload_generation() -> None:
    p = build_notification_payload(
        event_kind="validation_alert_opened",
        validation_id=1,
        validation_name="n",
        validation_type="AUTH_ONLY",
        stream_id=None,
        stream_name=None,
        connector_name=None,
        severity="WARNING",
        alert_type="DESTINATION_FAILURE",
        last_error=None,
        consecutive_failures=1,
        run_id=None,
        validation_run_id=None,
        message="m",
        route_id=None,
    )
    body = pd_notifier.body_for_pagerduty_v2(routing_key="test-key", payload=p)
    assert body["routing_key"] == "test-key"
    assert body["payload"]["severity"] == "warning"


def test_webhook_notification_delivery() -> None:
    from app.validation.notifiers import dispatcher as d2

    payload = build_notification_payload(
        event_kind="validation_alert_opened",
        validation_id=1,
        validation_name="n",
        validation_type="AUTH_ONLY",
        stream_id=None,
        stream_name=None,
        connector_name=None,
        severity="INFO",
        alert_type=None,
        last_error=None,
        consecutive_failures=0,
        run_id=None,
        validation_run_id=None,
        message="x",
        route_id=None,
    )
    with patch.object(d2, "_split_urls", return_value=["http://127.0.0.1:9/notify"]):
        with patch.object(d2.httpx, "Client") as m:
            inst = MagicMock()
            ctx = MagicMock()
            m.return_value = ctx
            ctx.__enter__.return_value = inst
            inst.post.return_value = MagicMock(status_code=202)
            d2.dispatch_validation_notifications_sync(payload)
            assert inst.post.called


def test_acknowledge_flow(client: TestClient, db_session: Session) -> None:
    sid = _mk_stream_hierarchy(db_session)
    v = ContinuousValidation(
        name="ack",
        enabled=True,
        validation_type="AUTH_ONLY",
        target_stream_id=sid,
        schedule_seconds=300,
        expect_checkpoint_advance=False,
        last_status="HEALTHY",
        consecutive_failures=0,
    )
    db_session.add(v)
    db_session.commit()
    db_session.refresh(v)
    apply_validation_alert_cycle(
        db_session,
        validation=v,
        prev_last_status="HEALTHY",
        overall="FAIL",
        messages=["401"],
        stats={},
        summary={"outcome": "source_fetch_failed", "message": "401", "transaction_committed": False, "run_id": None},
        had_auth_failure=True,
        had_checkpoint_drift=False,
        validation_run_id=None,
        latency_ms=1,
    )
    db_session.commit()
    aid = db_session.query(ValidationAlert).filter(ValidationAlert.validation_id == v.id).first()
    assert aid is not None
    r = client.post(f"/api/v1/validation/alerts/{aid.id}/acknowledge", json={})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ACKNOWLEDGED"


def test_failures_summary_api(client: TestClient) -> None:
    r = client.get("/api/v1/validation/failures/summary")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "failing_validations_count" in body
    assert "latest_open_alerts" in body


def test_dashboard_summary_embeds_validation_operational(client: TestClient) -> None:
    r = client.get("/api/v1/runtime/dashboard/summary?limit=5&window=1h")
    assert r.status_code == 200, r.text
    assert "validation_operational" in r.json()
    vo = r.json()["validation_operational"]
    assert vo["open_alerts_critical"] >= 0


def test_prolonged_failing_timeout_alert(db_session: Session) -> None:
    sid = _mk_stream_hierarchy(db_session)
    v = ContinuousValidation(
        name="timeout",
        enabled=True,
        validation_type="AUTH_ONLY",
        target_stream_id=sid,
        schedule_seconds=300,
        expect_checkpoint_advance=False,
        last_status="FAILING",
        consecutive_failures=3,
        last_failing_started_at=utcnow() - timedelta(hours=2),
    )
    db_session.add(v)
    db_session.commit()
    db_session.refresh(v)

    apply_validation_alert_cycle(
        db_session,
        validation=v,
        prev_last_status="FAILING",
        overall="FAIL",
        messages=["still bad"],
        stats={},
        summary={"outcome": "source_fetch_failed", "message": "401", "transaction_committed": False, "run_id": None},
        had_auth_failure=True,
        had_checkpoint_drift=False,
        validation_run_id=None,
        latency_ms=1,
    )
    db_session.commit()
    assert db_session.query(ValidationAlert).filter(ValidationAlert.alert_type == "VALIDATION_TIMEOUT").count() >= 1


def test_build_failures_summary_counts(db_session: Session) -> None:
    out = build_failures_summary(db_session, limit=10)
    assert out["failing_validations_count"] >= 0
    assert isinstance(out["latest_open_alerts"], list)
