"""Drop Field — mapping, schema drift, protection rules, and runtime behavior."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.mappers.mapper import apply_mapping
from app.protection.engine import protect_batch
from app.protection.field_drop import remove_field_at_path
from app.protection.models import PROTECTION_MODE_DROP_FIELD, StreamProtectionRule
from app.schema_drift_policy.orchestrator import apply_schema_drift_policy_to_batch
from app.schema_observation.models import DRIFT_CATEGORY_FIELD_ADDED, DRIFT_STATUS_OPEN, StreamSchemaFieldDrift
from tests.test_schema_drift_policy_runtime import _configure_nickname_mapping, _run_batch, _seed_stream_runtime


def test_remove_nested_field_path() -> None:
    event = {"user": {"name": "alice", "nickname": "ali"}, "message": "hi"}
    removed = remove_field_at_path(event, "$.user.nickname")
    assert removed == 1
    assert event == {"user": {"name": "alice"}, "message": "hi"}


def test_remove_missing_field_is_noop() -> None:
    event = {"user": {"name": "alice"}}
    removed = remove_field_at_path(event, "$.user.missing")
    assert removed == 0
    assert event == {"user": {"name": "alice"}}


def test_remove_field_in_array_elements() -> None:
    event = {"items": [{"tag": "a", "extra": 1}, {"tag": "b", "extra": 2}]}
    removed = remove_field_at_path(event, "$.items[].extra")
    assert removed == 2
    assert event == {"items": [{"tag": "a"}, {"tag": "b"}]}


def test_mapping_drop_unmapped_fields() -> None:
    event = {"id": "1", "user": {"name": "alice", "nickname": "ali"}, "message": "hi"}
    field_mappings = {
        "event_id": "$.id",
        "message": "$.message",
        "unmapped_fields_policy": "drop_unmapped",
    }
    mapped = apply_mapping(event, field_mappings)
    assert mapped == {"event_id": "1", "message": "hi"}


def test_mapping_pass_through_default_unchanged() -> None:
    event = {"id": "1", "user": {"name": "alice"}, "message": "hi"}
    field_mappings = {"event_id": "$.id", "message": "$.message"}
    mapped = apply_mapping(event, field_mappings)
    assert mapped["event_id"] == "1"
    assert mapped["message"] == "hi"
    assert mapped["user"] == {"name": "alice"}


def test_protection_rule_drop_field() -> None:
    events = [{"email": "secret@example.com", "message": "hello"}]
    rule = StreamProtectionRule(
        id=1,
        stream_id=1,
        field_path="$.email",
        sensitivity_class="pii",
        protection_mode=PROTECTION_MODE_DROP_FIELD,
        enabled=True,
        created_by="test",
    )
    result = protect_batch(events, [rule], stream_id=1)
    assert result.events[0] == {"message": "hello"}
    assert result.masked_field_applications == 1


def test_drop_field_vs_quarantine_block(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Drop removes only the field; quarantine blocks delivery (no webhook send)."""
    fixture = _seed_stream_runtime(db_session)
    stream_id = fixture["stream_id"]
    _configure_nickname_mapping(db_session, stream_id)

    from app.streams.models import Stream

    stream = db_session.query(Stream).filter(Stream.id == stream_id).one()
    config = dict(stream.config_json or {})
    governance = dict(config.get("governance") or {})
    governance["schema_drift_policy"] = {
        "unknown_normal_field_policy": "drop_field",
        "unknown_sensitive_field_policy": "auto_protect",
    }
    config["governance"] = governance
    stream.config_json = config
    db_session.commit()

    now = datetime.now(timezone.utc)
    db_session.add(
        StreamSchemaFieldDrift(
            stream_id=stream_id,
            field_path="$.user.nickname",
            category=DRIFT_CATEGORY_FIELD_ADDED,
            status=DRIFT_STATUS_OPEN,
            first_detected_at=now,
            last_confirmed_at=now,
        )
    )
    db_session.commit()

    monkeypatch.setattr("app.config.settings.GDC_SENSITIVE_DETECTION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_DRIFT_POLICY_ENABLED", True)

    from tests.test_stream_runner_e2e import _FakePoller, _FakeWebhookSender, _build_runner
    from app.runners.stream_loader import load_stream_context
    from app.runners.stream_runner import StreamRunner

    poller = _FakePoller(
        response={"items": [{"id": "evt-1", "user": {"nickname": "alice"}, "message": "hello"}]}
    )
    sender = _FakeWebhookSender()
    runner = _build_runner(poller=poller, webhook_sender=sender)
    ctx = load_stream_context(db_session, stream_id)
    runner.run(ctx, db=db_session)

    assert len(sender.calls) == 1
    delivered_events = sender.calls[0]["events"]
    assert len(delivered_events) == 1
    delivered = delivered_events[0]
    assert "nickname" not in delivered
    assert delivered.get("message") == "hello"

    governance["schema_drift_policy"] = {
        "unknown_normal_field_policy": "quarantine",
        "unknown_sensitive_field_policy": "auto_protect",
    }
    config["governance"] = governance
    stream.config_json = config
    db_session.commit()

    poller2 = _FakePoller(
        response={"items": [{"id": "evt-2", "user": {"nickname": "bob"}, "message": "hello"}]}
    )
    sender2 = _FakeWebhookSender()
    runner2 = _build_runner(poller=poller2, webhook_sender=sender2)
    runner2.run(ctx, db=db_session)
    assert len(sender2.calls) == 0


def test_schema_drift_unknown_normal_drop_ephemeral_rules(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_DRIFT_POLICY_ENABLED", True)
    fixture = _seed_stream_runtime(db_session)
    stream_id = fixture["stream_id"]
    now = datetime.now(timezone.utc)
    db_session.add(
        StreamSchemaFieldDrift(
            stream_id=stream_id,
            field_path="$.user.nickname",
            category=DRIFT_CATEGORY_FIELD_ADDED,
            status=DRIFT_STATUS_OPEN,
            first_detected_at=now,
            last_confirmed_at=now,
        )
    )
    db_session.commit()

    result = apply_schema_drift_policy_to_batch(
        db_session,
        stream_id=stream_id,
        stream_config_json={
            "governance": {
                "schema_drift_policy": {
                    "unknown_normal_field_policy": "drop_field",
                    "unknown_sensitive_field_policy": "auto_protect",
                }
            }
        },
        field_mappings={"event_id": "$.id", "nickname": "$.user.nickname"},
        enrichment_json={},
        enriched_events=[{"event_id": "1", "nickname": "ali", "message": "hi"}],
        detection_context=None,
    )
    assert result.batch_action == "drop_field"
    assert len(result.ephemeral_protection_rules) == 1
    assert result.ephemeral_protection_rules[0].protection_mode == PROTECTION_MODE_DROP_FIELD
    assert result.ephemeral_protection_rules[0].field_path == "$.nickname"


def test_schema_drift_unknown_sensitive_drop(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_DRIFT_POLICY_ENABLED", True)
    fixture = _seed_stream_runtime(db_session)
    stream_id = fixture["stream_id"]
    now = datetime.now(timezone.utc)
    db_session.add(
        StreamSchemaFieldDrift(
            stream_id=stream_id,
            field_path="$.user.email",
            category=DRIFT_CATEGORY_FIELD_ADDED,
            status=DRIFT_STATUS_OPEN,
            first_detected_at=now,
            last_confirmed_at=now,
        )
    )
    db_session.commit()

    from app.sensitive_detection.context import build_sensitive_detection_context

    enriched = [{"event_id": "1", "email": "a@b.com", "message": "hi"}]
    detection_context = build_sensitive_detection_context(
        stream_id=stream_id,
        events=enriched,
        findings=[{"field_path": "$.email", "sensitivity_class": "pii"}],
    )
    result = apply_schema_drift_policy_to_batch(
        db_session,
        stream_id=stream_id,
        stream_config_json={
            "governance": {
                "schema_drift_policy": {
                    "unknown_normal_field_policy": "pass_through",
                    "unknown_sensitive_field_policy": "drop_field",
                }
            }
        },
        field_mappings={"event_id": "$.id", "email": "$.user.email"},
        enrichment_json={},
        enriched_events=[{"event_id": "1", "email": "a@b.com", "message": "hi"}],
        detection_context=detection_context,
    )
    assert result.batch_action == "drop_field"
    assert result.ephemeral_protection_rules[0].field_path == "$.email"


def test_schema_drift_drop_field_policy_validation() -> None:
    from app.schema_drift_policy.schemas import validate_schema_drift_policy_payload

    payload = validate_schema_drift_policy_payload(
        {"unknown_normal_field_policy": "drop_field", "unknown_sensitive_field_policy": "drop_field"}
    )
    assert payload == {
        "unknown_normal_field_policy": "drop_field",
        "unknown_sensitive_field_policy": "drop_field",
    }
