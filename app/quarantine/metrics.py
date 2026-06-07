"""Quarantine delivery_logs observability (summary uses stream_quarantine_events only)."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.logs.models import DeliveryLog

QUARANTINE_EVENT_CREATED_STAGE = "quarantine_event_created"
QUARANTINE_EVENT_CREATE_FAILED_STAGE = "quarantine_event_create_failed"
QUARANTINE_EVENT_RELEASED_STAGE = "quarantine_event_released"
QUARANTINE_EVENT_RELEASE_FAILED_STAGE = "quarantine_event_release_failed"
QUARANTINE_EVENT_DISCARDED_STAGE = "quarantine_event_discarded"


def _base_payload(
    *,
    stream_id: int,
    quarantine_event_id: int,
    status: str,
    quarantine_reason: str,
    **extra: Any,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "stream_id": stream_id,
        "quarantine_event_id": quarantine_event_id,
        "status": status,
        "quarantine_reason": quarantine_reason,
    }
    payload.update(extra)
    return payload


def persist_quarantine_observability_log(
    db: Session,
    *,
    stage: str,
    stream_id: int,
    quarantine_event_id: int,
    status: str,
    quarantine_reason: str,
    message: str = "",
    level: str = "INFO",
    log_status: str = "OK",
    error_code: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    payload = _base_payload(
        stream_id=stream_id,
        quarantine_event_id=quarantine_event_id,
        status=status,
        quarantine_reason=quarantine_reason,
    )
    if extra:
        payload.update(extra)

    row = DeliveryLog(
        stream_id=stream_id,
        stage=stage,
        level=level,
        status=log_status,
        message=message or stage,
        payload_sample=payload,
        retry_count=0,
        error_code=error_code,
    )
    db.add(row)
    db.flush()
