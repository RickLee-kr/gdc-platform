"""StreamRunner functional regression for Record Selection extraction contract."""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.logs.models import DeliveryLog
from app.mappings.models import Mapping
from app.routes.models import Route
from app.runners.stream_loader import load_stream_context
from app.runners.stream_runner import StreamRunner
from app.sources.models import Source
from app.streams.models import Stream

pytestmark = pytest.mark.functional_regression

RECORDS_ENVELOPE = {
    "Records": [
        {
            "event": {
                "id": 1,
                "eventVersion": "1.0",
                "eventTime": "2026-05-11T12:00:00Z",
            },
            "ResponseMetadata": {"RequestId": "req-abc"},
        },
        {
            "event": {
                "id": 2,
                "eventVersion": "1.0",
                "eventTime": "2026-05-11T12:01:00Z",
            },
            "ResponseMetadata": {"RequestId": "req-def"},
        },
    ],
    "wrapper": True,
}

ROOT_ARRAY_PAYLOAD = [
    {
        "id": "root-1",
        "creationTime": "2026-05-11T12:00:00Z",
        "message": "root array event one",
        "severity": "INFO",
    },
    {
        "id": "root-2",
        "creationTime": "2026-05-11T12:01:00Z",
        "message": "root array event two",
        "severity": "LOW",
    },
]


class _AllowAllLimiter:
    def allow(self, _value: int, rate_limit_json: dict[str, Any] | None = None) -> bool:
        return True


class _FakePoller:
    def __init__(self, response: Any) -> None:
        self.response = response
        self.calls: list[dict[str, Any]] = []

    def fetch(
        self,
        source_config: dict[str, Any],
        stream_config: dict[str, Any],
        checkpoint: dict[str, Any] | None,
    ) -> Any:
        self.calls.append(
            {
                "source_config": source_config,
                "stream_config": stream_config,
                "checkpoint": checkpoint,
            }
        )
        return self.response


class _CaptureWebhookSender:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def send(
        self,
        events: list[dict[str, Any]],
        config: dict[str, Any],
        formatter_override: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        self.calls.append({"events": list(events), "config": dict(config), "formatter_override": formatter_override})


class _FailIfCalledSyslogSender:
    def send(self, *args: Any, **kwargs: Any) -> None:
        raise AssertionError("syslog sender should not be called")


def _seed_stream(
    db: Session,
    *,
    event_array_path: str | None,
    event_root_path: str | None,
    field_mappings: dict[str, str],
    enrichment: dict[str, Any],
) -> int:
    connector = Connector(name="fr-stream-runner", description="functional regression", status="RUNNING")
    db.add(connector)
    db.flush()

    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={"base_url": "https://api.example.com"},
        auth_json={"Authorization": "Bearer test"},
        enabled=True,
    )
    db.add(source)
    db.flush()

    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="fr-stream-runner-stream",
        stream_type="HTTP_API_POLLING",
        config_json={"endpoint": "/events", "method": "GET"},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={"max_requests": 10, "per_seconds": 60},
    )
    db.add(stream)
    db.flush()

    db.add(
        Mapping(
            stream_id=stream.id,
            event_array_path=event_array_path,
            event_root_path=event_root_path,
            field_mappings_json=field_mappings,
            raw_payload_mode="JSON",
        )
    )
    db.add(
        Enrichment(
            stream_id=stream.id,
            enrichment_json=enrichment,
            override_policy="OVERRIDE",
            enabled=True,
        )
    )

    destination = Destination(
        name="fr-webhook",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://receiver.example.com/events", "retry_count": 0},
        rate_limit_json={"max_events": 1000, "per_seconds": 1},
        enabled=True,
    )
    db.add(destination)
    db.flush()

    db.add(
        Route(
            stream_id=stream.id,
            destination_id=destination.id,
            enabled=True,
            failure_policy="LOG_AND_CONTINUE",
            formatter_config_json={},
            rate_limit_json={},
            status="ENABLED",
        )
    )
    db.add(
        Checkpoint(
            stream_id=stream.id,
            checkpoint_type="CUSTOM_FIELD",
            checkpoint_value_json={},
        )
    )
    db.commit()
    return int(stream.id)


def _delivery_logs(db: Session, stream_id: int) -> list[DeliveryLog]:
    return (
        db.query(DeliveryLog)
        .filter(DeliveryLog.stream_id == stream_id)
        .order_by(DeliveryLog.id.asc())
        .all()
    )


def test_stream_runner_records_event_root_delivers_nested_events_only(db_session: Session) -> None:
    stream_id = _seed_stream(
        db_session,
        event_array_path="$.Records",
        event_root_path="$.event",
        field_mappings={
            "event_id": "$.id",
            "event_time": "$.eventTime",
            "event_version": "$.eventVersion",
        },
        enrichment={"pipeline": "stream-runner-fr", "vendor": "RecordSelectionRunner"},
    )
    context = load_stream_context(db_session, stream_id)
    sender = _CaptureWebhookSender()
    runner = StreamRunner(
        poller=_FakePoller(RECORDS_ENVELOPE),
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        webhook_sender=sender,
        syslog_sender=_FailIfCalledSyslogSender(),
    )

    runner.run(context, db=db_session)

    assert len(sender.calls) == 1
    delivered = sender.calls[0]["events"]
    assert len(delivered) == 2
    ids = {ev.get("event_id") for ev in delivered}
    assert ids == {1, 2}
    for ev in delivered:
        assert ev.get("pipeline") == "stream-runner-fr"
        assert ev.get("vendor") == "RecordSelectionRunner"
        assert "Records" not in ev
        assert "ResponseMetadata" not in ev
        assert "wrapper" not in ev

    cp = db_session.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).one()
    assert cp.checkpoint_value_json.get("last_success_event", {}).get("event_id") == 2

    stages = {row.stage for row in _delivery_logs(db_session, stream_id)}
    assert "route_send_success" in stages
    assert "checkpoint_update" in stages
    assert "run_complete" in stages


def test_stream_runner_root_array_without_event_root_delivers_all_records(db_session: Session) -> None:
    stream_id = _seed_stream(
        db_session,
        event_array_path=None,
        event_root_path=None,
        field_mappings={
            "event_id": "$.id",
            "message": "$.message",
            "severity": "$.severity",
        },
        enrichment={"pipeline": "root-array-runner"},
    )
    context = load_stream_context(db_session, stream_id)
    sender = _CaptureWebhookSender()
    runner = StreamRunner(
        poller=_FakePoller(ROOT_ARRAY_PAYLOAD),
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        webhook_sender=sender,
        syslog_sender=_FailIfCalledSyslogSender(),
    )

    runner.run(context, db=db_session)

    delivered = sender.calls[0]["events"]
    assert {ev.get("event_id") for ev in delivered} == {"root-1", "root-2"}
    for ev in delivered:
        assert ev.get("pipeline") == "root-array-runner"


def test_stream_runner_destination_failure_does_not_advance_checkpoint(db_session: Session) -> None:
    stream_id = _seed_stream(
        db_session,
        event_array_path="$.Records",
        event_root_path="$.event",
        field_mappings={"event_id": "$.id", "event_time": "$.eventTime"},
        enrichment={"pipeline": "failure-runner"},
    )
    route = db_session.query(Route).filter(Route.stream_id == stream_id).one()
    route.failure_policy = "PAUSE_STREAM_ON_FAILURE"
    cp_before = dict(db_session.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).one().checkpoint_value_json or {})
    db_session.commit()

    context = load_stream_context(db_session, stream_id)

    class _FailWebhookSender(_CaptureWebhookSender):
        def send(self, events: list[dict[str, Any]], config: dict[str, Any], **kwargs: Any) -> None:
            raise RuntimeError("destination down")

    runner = StreamRunner(
        poller=_FakePoller(RECORDS_ENVELOPE),
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        webhook_sender=_FailWebhookSender(),
        syslog_sender=_FailIfCalledSyslogSender(),
    )
    runner.run(context, db=db_session)

    cp_after = dict(db_session.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).one().checkpoint_value_json or {})
    assert cp_after == cp_before
    stages = {row.stage for row in _delivery_logs(db_session, stream_id)}
    assert "route_send_failed" in stages
    assert "checkpoint_update" not in stages
    assert "route_send_success" not in stages
    assert context.stream["status"] == "PAUSED"
