"""Protection delivery_logs metrics (bounded reads; no full-table scans)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.logs.models import DeliveryLog
from app.platform_summary.stage_metrics import load_latest_stage_row, load_recent_stage_rows
from app.protection.engine import ProtectBatchResult

PROTECTION_COMPLETE_STAGE = "protection_complete"
_DEFAULT_RECENT_LOG_LIMIT = 500


def protection_run_counts(
    result: ProtectBatchResult,
    *,
    enriched_event_count: int,
) -> tuple[int, int, int]:
    """Return (rule_count, protected_event_count, protected_field_count) for one run."""

    rule_count = int(result.rules_applied or 0)
    if rule_count <= 0:
        return 0, 0, 0
    protected_events = max(0, int(enriched_event_count))
    protected_fields = max(0, int(result.masked_field_applications or 0))
    return rule_count, protected_events, protected_fields


def build_protection_complete_payload(
    *,
    stream_id: int,
    result: ProtectBatchResult,
    enriched_event_count: int,
    cumulative_totals: dict[str, int],
) -> dict[str, Any]:
    """Structured payload for protection_complete delivery_logs row."""

    rule_count, protected_event_count, protected_field_count = protection_run_counts(
        result,
        enriched_event_count=enriched_event_count,
    )
    prev_events = int(cumulative_totals.get("total_protected_events") or 0)
    prev_fields = int(cumulative_totals.get("total_protected_fields") or 0)
    total_protected_events = prev_events + protected_event_count
    total_protected_fields = prev_fields + protected_field_count
    processing_time_ms = max(0, int(result.duration_ms or 0))

    payload: dict[str, Any] = {
        "stage": PROTECTION_COMPLETE_STAGE,
        "stream_id": stream_id,
        "message": "protection complete",
        "rule_count": rule_count,
        "protected_event_count": protected_event_count,
        "protected_field_count": protected_field_count,
        "processing_time_ms": processing_time_ms,
        "latency_ms": processing_time_ms,
        "total_protected_events": total_protected_events,
        "total_protected_fields": total_protected_fields,
        "warning_count": int(result.warning_count or 0),
        # Backward-compatible keys for log readers / tests
        "rules_applied": rule_count,
        "masked_field_applications": protected_field_count,
        "duration_ms": processing_time_ms,
    }
    if int(result.tokenization_batch_items or 0) > 0:
        payload["tokenization_batch_items"] = int(result.tokenization_batch_items)
        payload["tokenization_cache_hits"] = int(result.tokenization_cache_hits or 0)
        payload["tokenization_created"] = int(result.tokenization_created or 0)
    return payload


def load_cumulative_protection_totals(db: Session, stream_id: int) -> dict[str, int]:
    """Read running totals from the latest committed protection_complete row (one row)."""

    row = load_latest_stage_row(
        db,
        stream_id=int(stream_id),
        stage=PROTECTION_COMPLETE_STAGE,
    )
    if row is None:
        return {"total_protected_events": 0, "total_protected_fields": 0}
    sample = row.payload_sample if isinstance(row.payload_sample, dict) else {}
    return {
        "total_protected_events": max(0, int(sample.get("total_protected_events") or 0)),
        "total_protected_fields": max(0, int(sample.get("total_protected_fields") or 0)),
    }


def load_protection_runtime_metrics(
    db: Session,
    stream_id: int,
    *,
    total_rules: int,
    recent_log_limit: int = _DEFAULT_RECENT_LOG_LIMIT,
) -> dict[str, Any]:
    """Bounded metrics for protection summary / runtime UI."""

    latest = load_latest_stage_row(
        db,
        stream_id=int(stream_id),
        stage=PROTECTION_COMPLETE_STAGE,
    )
    if latest is not None:
        sample = latest.payload_sample if isinstance(latest.payload_sample, dict) else {}
        return {
            "protection_rules": max(0, int(total_rules)),
            "protected_events": max(0, int(sample.get("total_protected_events") or 0)),
            "protected_fields": max(0, int(sample.get("total_protected_fields") or 0)),
            "last_protected_at": latest.created_at,
        }

    rows = load_recent_stage_rows(
        db,
        stream_id=int(stream_id),
        stage=PROTECTION_COMPLETE_STAGE,
        limit=recent_log_limit,
    )
    total_events = 0
    total_fields = 0
    last_at: datetime | None = None
    for row in rows:
        sample = row.payload_sample if isinstance(row.payload_sample, dict) else {}
        total_events += max(0, int(sample.get("protected_event_count") or 0))
        total_fields += max(0, int(sample.get("protected_field_count") or 0))
        if last_at is None:
            last_at = row.created_at
    return {
        "protection_rules": max(0, int(total_rules)),
        "protected_events": total_events,
        "protected_fields": total_fields,
        "last_protected_at": last_at,
    }
