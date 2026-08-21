"""Runtime observability / failure evidence — DeliveryLog lifecycle correlation."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.logs.models import DeliveryLog
from app.logs.payload_sample import build_delivery_log_payload_sample
from app.observability.runtime_evidence import EVIDENCE_STAGE, has_evidence
from app.runtime.stream_configuration_service import _checkpoint_activity
from app.runners.stream_loader import load_stream_context
from app.security.secrets import SECRET_MASK
from tests.e2e_wiremock_helpers import assert_failure_hold_evidence, assert_success_lifecycle_evidence
from tests.test_stream_runner_e2e import (
    _FakePoller,
    _FakeWebhookSender,
    _RetryAwareWebhookSender,
    _build_runner,
    _checkpoint_value,
    _delivery_logs,
    _seed_stream_runtime,
)


@pytest.fixture
def db(db_session: Session) -> Session:
    return db_session


def test_payload_sample_masks_secrets() -> None:
    sample = build_delivery_log_payload_sample(
        {
            "stage": "delivery_attempt",
            "api_key": "super-secret-key",
            "authorization": "Bearer leak-token",
            "headers": {"Authorization": "Bearer leak-token", "X-Api-Key": "k1"},
            "password": "p@ss",
            "message": "ok",
            "stream_id": 1,
        }
    )
    assert sample["api_key"] == SECRET_MASK
    assert sample["authorization"] == SECRET_MASK
    assert sample["password"] == SECRET_MASK
    assert sample["headers"]["Authorization"] == SECRET_MASK
    assert sample["headers"]["X-Api-Key"] == SECRET_MASK
    assert "leak-token" not in str(sample)
    assert "super-secret-key" not in str(sample)


def test_evidence_stage_mapping() -> None:
    assert EVIDENCE_STAGE["source_fetch_succeeded"] == "source_fetch"
    assert EVIDENCE_STAGE["checkpoint_advanced"] == "checkpoint_update"
    assert has_evidence({"source_fetch", "route_send_success"}, "source_fetch_succeeded")
    assert has_evidence({"checkpoint_update"}, "checkpoint_advanced")
    assert not has_evidence({"run_started"}, "checkpoint_held")


def test_success_path_emits_correlated_lifecycle_evidence(db: Session) -> None:
    seeded = _seed_stream_runtime(db)
    context = load_stream_context(db, seeded["stream_id"])
    poller = _FakePoller(
        response={"items": [{"id": "obs-ok-1", "message": "lifecycle", "vendor": "MappedVendor"}]}
    )
    runner = _build_runner(poller=poller, webhook_sender=_FakeWebhookSender())

    summary = runner.run(context, db=db)
    run_id = str(summary["run_id"])
    assert_success_lifecycle_evidence(db, seeded["stream_id"], run_id)

    rows = _delivery_logs(db, seeded["stream_id"])
    by_run = [r for r in rows if r.run_id == run_id]
    stages = [r.stage for r in by_run]
    assert stages.index("source_fetch_started") < stages.index("source_fetch")
    assert stages.index("delivery_attempt") < stages.index("route_send_success")
    assert stages.index("route_send_success") < stages.index("checkpoint_update")

    delivery = next(r for r in by_run if r.stage == "delivery_attempt")
    assert delivery.route_id == seeded["route_ids"][0]
    assert delivery.destination_id == seeded["destination_ids"][0]
    assert delivery.retry_count == 1


def test_source_fetch_failure_emits_failed_and_checkpoint_held(db: Session) -> None:
    seeded = _seed_stream_runtime(db)
    context = load_stream_context(db, seeded["stream_id"])
    poller = _FakePoller(error=RuntimeError("source fetch failed"))
    runner = _build_runner(poller=poller, webhook_sender=_FakeWebhookSender())

    before = _checkpoint_value(db, seeded["stream_id"])
    with pytest.raises(RuntimeError, match="source fetch failed"):
        runner.run(context, db=db)
    after = _checkpoint_value(db, seeded["stream_id"])
    assert before == after

    db.expire_all()
    started = (
        db.query(DeliveryLog)
        .filter(DeliveryLog.stream_id == seeded["stream_id"], DeliveryLog.stage == "run_started")
        .order_by(DeliveryLog.id.desc())
        .first()
    )
    assert started is not None and started.run_id
    run_id = str(started.run_id)
    assert_failure_hold_evidence(db, seeded["stream_id"], run_id)

    stages = {
        r.stage
        for r in db.query(DeliveryLog)
        .filter(DeliveryLog.stream_id == seeded["stream_id"], DeliveryLog.run_id == run_id)
        .all()
    }
    assert "source_fetch_started" in stages
    assert "source_fetch_failed" in stages
    assert "run_failed" in stages
    assert "checkpoint_held" in stages


def test_destination_failure_emits_delivery_attempt_and_checkpoint_held(db: Session) -> None:
    seeded = _seed_stream_runtime(db, failure_policies=["PAUSE_STREAM_ON_FAILURE"])
    context = load_stream_context(db, seeded["stream_id"])
    poller = _FakePoller(
        response={"items": [{"id": "obs-fail-1", "message": "dest-fail", "vendor": "MappedVendor"}]}
    )
    sender = _FakeWebhookSender(fail_urls={"https://receiver-0.example.com/events"})
    runner = _build_runner(poller=poller, webhook_sender=sender)

    before = _checkpoint_value(db, seeded["stream_id"])
    summary = runner.run(context, db=db)
    run_id = str(summary["run_id"])
    after = _checkpoint_value(db, seeded["stream_id"])
    assert before == after
    assert summary.get("checkpoint_updated") is False

    rows = [
        r
        for r in _delivery_logs(db, seeded["stream_id"])
        if r.run_id == run_id
    ]
    stages = {r.stage for r in rows}
    assert "delivery_attempt" in stages
    assert "route_send_failed" in stages
    assert "checkpoint_held" in stages
    assert "checkpoint_update" not in stages
    assert "route_send_success" not in stages


def test_retry_scheduled_and_recovery_success_evidence(db: Session) -> None:
    seeded = _seed_stream_runtime(db, failure_policies=["RETRY_AND_BACKOFF"])
    context = load_stream_context(db, seeded["stream_id"])
    context.routes[0]["retry_count"] = 2
    context.routes[0]["backoff_seconds"] = 0

    poller = _FakePoller(
        response={"items": [{"id": "obs-retry-1", "message": "retry", "vendor": "MappedVendor"}]}
    )
    sender = _RetryAwareWebhookSender({"https://receiver-0.example.com/events": 1})
    runner = _build_runner(poller=poller, webhook_sender=sender)  # type: ignore[arg-type]
    summary = runner.run(context, db=db)
    run_id = str(summary["run_id"])

    rows = [r for r in _delivery_logs(db, seeded["stream_id"]) if r.run_id == run_id]
    stages = {r.stage for r in rows}
    assert "route_send_failed" in stages
    assert "retry_scheduled" in stages
    assert "route_retry_success" in stages
    assert "recovery_success" in stages
    assert "checkpoint_update" in stages
    retry_row = next(r for r in rows if r.stage == "retry_scheduled")
    assert retry_row.route_id == seeded["route_ids"][0]
    assert int(retry_row.retry_count) >= 1


def test_checkpoint_activity_uses_real_delivery_log_stages(db: Session) -> None:
    """Product defect fix: activity queries must match stages StreamRunner actually writes."""

    seeded = _seed_stream_runtime(db)
    context = load_stream_context(db, seeded["stream_id"])
    poller = _FakePoller(
        response={"items": [{"id": "obs-act-1", "message": "activity", "vendor": "MappedVendor"}]}
    )
    runner = _build_runner(poller=poller, webhook_sender=_FakeWebhookSender())
    runner.run(context, db=db)

    activity = _checkpoint_activity(db, seeded["stream_id"])
    assert activity["last_success_at"] is not None
    assert activity["last_collected_event_at"] is not None
