"""Record protected delivery payloads when policy quarantine matches."""

from __future__ import annotations

import logging
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.protection.policy_engine import PolicyBatchResult
from app.quarantine.metrics import (
    QUARANTINE_EVENT_CREATE_FAILED_STAGE,
    QUARANTINE_EVENT_CREATED_STAGE,
    persist_quarantine_observability_log,
)
from app.quarantine.models import (
    QUARANTINE_SOURCE_POLICY,
    QUARANTINE_STATUS_QUARANTINED,
    StreamQuarantineEvent,
)
from app.quarantine.policy_integration import build_quarantine_reason, matched_quarantine_evaluations

logger = logging.getLogger(__name__)

_MAX_EVENTS = 500


def _snapshot_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in events[:_MAX_EVENTS]:
        if isinstance(item, dict):
            out.append(deepcopy(item))
    return out


def record_policy_quarantine_event(
    db: Session,
    *,
    stream_id: int,
    delivery_events: list[dict[str, Any]],
    policy_result: PolicyBatchResult,
) -> StreamQuarantineEvent | None:
    """Persist quarantine row from protected delivery batch; never stores enriched events."""

    matched = matched_quarantine_evaluations(policy_result)
    if not matched:
        return None

    payload = _snapshot_events(delivery_events)
    if not payload:
        return None

    reason = build_quarantine_reason(policy_result)
    now = datetime.now(timezone.utc)
    metadata = {
        "event_count": len(payload),
        "policy_ids": [int(item.policy_id) for item in matched],
        "policy_names": [str(item.policy_name) for item in matched],
    }
    row = StreamQuarantineEvent(
        stream_id=int(stream_id),
        quarantine_reason=reason[:256],
        quarantine_source=QUARANTINE_SOURCE_POLICY,
        status=QUARANTINE_STATUS_QUARANTINED,
        protected_payload_json={"events": payload},
        metadata_json=metadata,
        created_at=now,
        updated_at=now,
    )
    try:
        db.add(row)
        db.flush()
        persist_quarantine_observability_log(
            db,
            stage=QUARANTINE_EVENT_CREATED_STAGE,
            stream_id=int(stream_id),
            quarantine_event_id=int(row.id),
            status=row.status,
            quarantine_reason=reason,
            message="quarantine event created",
            extra={"event_count": len(payload), "quarantine_source": QUARANTINE_SOURCE_POLICY},
        )
        try:
            from app.governance_violations.service import record_quarantine_governance_notifications

            record_quarantine_governance_notifications(db, row)
        except Exception:
            logger.exception("governance_quarantine_notification_failed quarantine_event_id=%s", row.id)
        return row
    except Exception as exc:
        logger.exception("quarantine_event_record_failed stream_id=%s", stream_id)
        try:
            persist_quarantine_observability_log(
                db,
                stage=QUARANTINE_EVENT_CREATE_FAILED_STAGE,
                stream_id=int(stream_id),
                quarantine_event_id=0,
                status=QUARANTINE_STATUS_QUARANTINED,
                quarantine_reason=reason,
                message=str(exc)[:500],
                level="ERROR",
                log_status="FAILED",
                error_code="QUARANTINE_RECORD_FAILED",
            )
        except Exception:
            logger.exception("quarantine_event_create_failed_log_failed stream_id=%s", stream_id)
        return None
