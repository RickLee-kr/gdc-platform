"""AI audit events REST API (M23)."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.ai_audit.models import AI_AUDIT_EVENT_TYPES
from app.ai_audit.schemas import (
    AiAuditCorrelationResponse,
    AiAuditDeliveryLogRef,
    AiAuditEventListResponse,
    AiAuditEventRead,
    AiAuditMetricsSummary,
)
from app.ai_audit.service import (
    AiAuditNotFoundError,
    build_ai_audit_metrics,
    correlate_ai_audit_request,
    list_ai_audit_events,
)
from app.database import get_db_read_bounded

router = APIRouter()


@router.get("/", response_model=AiAuditEventListResponse)
async def get_ai_audit_events(
    provider_id: int | None = Query(default=None, alias="provider"),
    stream_id: int | None = Query(default=None, alias="stream"),
    action: str | None = Query(default=None),
    event_type: str | None = Query(default=None),
    request_id: str | None = Query(default=None),
    created_from: datetime | None = Query(default=None),
    created_to: datetime | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db_read_bounded),
) -> AiAuditEventListResponse:
    if event_type is not None and str(event_type).strip().upper() not in AI_AUDIT_EVENT_TYPES:
        raise HTTPException(status_code=400, detail=f"unsupported event_type: {event_type!r}")

    evt = str(event_type).strip().upper() if event_type is not None else None
    events = list_ai_audit_events(
        db,
        provider_id=provider_id,
        stream_id=stream_id,
        action=action,
        event_type=evt,
        request_id=request_id,
        created_from=created_from,
        created_to=created_to,
        limit=limit,
    )
    return AiAuditEventListResponse(
        total=len(events),
        events=[AiAuditEventRead.model_validate(row) for row in events],
    )


@router.get("/correlation/{request_id}", response_model=AiAuditCorrelationResponse)
async def get_ai_audit_correlation(
    request_id: str,
    db: Session = Depends(get_db_read_bounded),
) -> AiAuditCorrelationResponse:
    try:
        payload = correlate_ai_audit_request(db, request_id)
    except AiAuditNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return AiAuditCorrelationResponse(
        request_id=payload["request_id"],
        stream_id=payload.get("stream_id"),
        ai_stream_id=payload.get("ai_stream_id"),
        ai_provider_id=payload.get("ai_provider_id"),
        provider=payload.get("provider"),
        model=payload.get("model"),
        policy_rule_ids=list(payload.get("policy_rule_ids") or []),
        events=[AiAuditEventRead.model_validate(row) for row in payload["events"]],
        delivery_logs=[
            AiAuditDeliveryLogRef(
                id=int(row.id),
                stage=str(row.stage),
                level=str(row.level),
                message=str(row.message),
                created_at=row.created_at,
                stream_id=row.stream_id,
                destination_id=row.destination_id,
            )
            for row in payload.get("delivery_logs") or []
        ],
    )


@router.get("/metrics/summary", response_model=AiAuditMetricsSummary)
async def get_ai_audit_metrics_summary(
    hours: int = Query(default=24, ge=1, le=168),
    stream_id: int | None = Query(default=None),
    provider_id: int | None = Query(default=None, alias="provider"),
    db: Session = Depends(get_db_read_bounded),
) -> AiAuditMetricsSummary:
    return AiAuditMetricsSummary.model_validate(
        build_ai_audit_metrics(db, hours=hours, stream_id=stream_id, provider_id=provider_id)
    )
