"""M6.1 — protection_complete delivery_logs, metrics, and summary totals."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import Session

from app.logs.models import DeliveryLog
from app.protection.metrics import (
    PROTECTION_COMPLETE_STAGE,
    build_protection_complete_payload,
    load_protection_runtime_metrics,
    protection_run_counts,
)
from app.protection.engine import ProtectBatchResult
from app.protection.models import StreamProtectionRule
from app.protection.operator_workflow import build_protection_summary
from tests.test_stream_runner_e2e import (
    _FakePoller,
    _FakeWebhookSender,
    _build_runner,
    _seed_stream_runtime,
)
from app.runners.stream_loader import load_stream_context


def test_protection_run_counts_zero_when_no_rules() -> None:
    result = ProtectBatchResult(events=[{"a": 1}], rules_applied=0, masked_field_applications=0)
    assert protection_run_counts(result, enriched_event_count=3) == (0, 0, 0)


def test_protection_run_counts_with_rules() -> None:
    result = ProtectBatchResult(events=[{"a": 1}], rules_applied=2, masked_field_applications=5)
    assert protection_run_counts(result, enriched_event_count=3) == (2, 3, 5)


def test_build_protection_complete_payload_cumulative() -> None:
    result = ProtectBatchResult(
        events=[{"x": 1}],
        rules_applied=1,
        masked_field_applications=2,
        duration_ms=12,
    )
    payload = build_protection_complete_payload(
        stream_id=9,
        result=result,
        enriched_event_count=4,
        cumulative_totals={"total_protected_events": 10, "total_protected_fields": 20},
    )
    assert payload["stage"] == PROTECTION_COMPLETE_STAGE
    assert payload["rule_count"] == 1
    assert payload["protected_event_count"] == 4
    assert payload["protected_field_count"] == 2
    assert payload["processing_time_ms"] == 12
    assert payload["total_protected_events"] == 14
    assert payload["total_protected_fields"] == 22


def test_build_protection_summary_includes_runtime_totals(db_session: Session) -> None:
    db = db_session
    fixture = _seed_stream_runtime(db)
    stream_id = fixture["stream_id"]
    now = datetime.now(timezone.utc)
    db.add(
        StreamProtectionRule(
            stream_id=stream_id,
            field_path="$.secret",
            sensitivity_class="secret",
            protection_mode="full_mask",
            enabled=True,
            created_by="test",
        )
    )
    db.add(
        DeliveryLog(
            stream_id=stream_id,
            stage=PROTECTION_COMPLETE_STAGE,
            level="INFO",
            status="OK",
            message="protection complete",
            payload_sample={
                "total_protected_events": 7,
                "total_protected_fields": 11,
                "protected_event_count": 2,
                "protected_field_count": 3,
            },
            retry_count=0,
            created_at=now,
        )
    )
    db.commit()

    summary = build_protection_summary(db, stream_id)
    assert summary["total_rules"] == 1
    assert summary["total_protected_events"] == 7
    assert summary["total_protected_fields"] == 11
    assert summary["protected_events"] == 7
    assert summary["protected_fields"] == 11
    assert summary["last_protected_at"] is not None


def test_load_protection_runtime_metrics_from_latest_row(db_session: Session) -> None:
    db = db_session
    fixture = _seed_stream_runtime(db)
    stream_id = fixture["stream_id"]
    db.add(
        DeliveryLog(
            stream_id=stream_id,
            stage=PROTECTION_COMPLETE_STAGE,
            level="INFO",
            status="OK",
            message="protection complete",
            payload_sample={"total_protected_events": 3, "total_protected_fields": 6},
            retry_count=0,
        )
    )
    db.commit()
    metrics = load_protection_runtime_metrics(db, stream_id, total_rules=2)
    assert metrics["protection_rules"] == 2
    assert metrics["protected_events"] == 3
    assert metrics["protected_fields"] == 6
    assert metrics["last_protected_at"] is not None


@pytest.fixture
def protection_runtime_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_PROTECTION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_PROTECTION_HASH_SALT", "test-obs-salt")


def test_run_once_persists_protection_complete_delivery_log(
    db_session: Session,
    protection_runtime_settings: None,
) -> None:
    db = db_session
    fixture = _seed_stream_runtime(db)
    stream_id = fixture["stream_id"]

    from app.mappings.models import Mapping

    mapping = db.query(Mapping).filter_by(stream_id=stream_id).one()
    mapping.field_mappings_json = {**dict(mapping.field_mappings_json or {}), "api_key": "$.api_key"}
    db.flush()
    db.add(
        StreamProtectionRule(
            stream_id=stream_id,
            field_path="$.api_key",
            sensitivity_class="secret",
            protection_mode="full_mask",
            enabled=True,
            created_by="test",
        )
    )
    db.commit()

    poller = _FakePoller(
        response={"items": [{"id": "e1", "api_key": "secret-val", "message": "hi", "vendor": "v"}]}
    )
    sender = _FakeWebhookSender()
    runner = _build_runner(poller=poller, webhook_sender=sender)
    ctx = load_stream_context(db, stream_id)
    runner.run(ctx, db=db)
    db.commit()

    row = (
        db.query(DeliveryLog)
        .filter(
            DeliveryLog.stream_id == stream_id,
            DeliveryLog.stage == PROTECTION_COMPLETE_STAGE,
        )
        .order_by(DeliveryLog.created_at.desc())
        .first()
    )
    assert row is not None
    sample = row.payload_sample if isinstance(row.payload_sample, dict) else {}
    assert sample.get("rule_count", 0) >= 1
    assert int(sample.get("protected_field_count") or 0) >= 1
    assert int(sample.get("total_protected_events") or 0) >= 1
    assert "processing_time_ms" in sample
