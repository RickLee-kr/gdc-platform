"""Governance audit trail REST API (M19.3)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth.governance_rbac import require_audit_read
from app.database import get_db_read_bounded
from app.governance_audit.models import AUDIT_EVENT_TYPES, AUDIT_STATUSES, AUDIT_WINDOWS
from app.governance_audit.schemas import GovernanceAuditDetailResponse, GovernanceAuditListResponse
from app.governance_audit.service import (
    GovernanceAuditNotFoundError,
    get_governance_audit_detail,
    list_governance_audit_events,
)

router = APIRouter()


@router.get("/audit", response_model=GovernanceAuditListResponse)
async def get_governance_audit_events(
    window: str = Query(default="24h"),
    policy_id: int | None = Query(default=None),
    stream_id: int | None = Query(default=None),
    event_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db_read_bounded),
    _auth=Depends(require_audit_read()),
) -> GovernanceAuditListResponse:
    win = str(window).strip().lower()
    if win not in AUDIT_WINDOWS:
        raise HTTPException(status_code=400, detail=f"unsupported window: {window!r}")

    if event_type is not None and str(event_type).upper() not in AUDIT_EVENT_TYPES:
        raise HTTPException(status_code=400, detail=f"unsupported event_type: {event_type!r}")
    if status is not None and str(status).upper() not in AUDIT_STATUSES:
        raise HTTPException(status_code=400, detail=f"unsupported status: {status!r}")

    evt = str(event_type).upper() if event_type is not None else None
    st = str(status).upper() if status is not None else None

    events = list_governance_audit_events(
        db,
        window=win,
        policy_id=policy_id,
        stream_id=stream_id,
        event_type=evt,
        status=st,
        limit=limit,
    )
    return GovernanceAuditListResponse(window=win, total=len(events), events=events)


@router.get("/audit/{correlation_id}", response_model=GovernanceAuditDetailResponse)
async def get_governance_audit_by_correlation_id(
    correlation_id: str,
    window: str = Query(default="30d"),
    db: Session = Depends(get_db_read_bounded),
    _auth=Depends(require_audit_read()),
) -> GovernanceAuditDetailResponse:
    win = str(window).strip().lower()
    if win not in AUDIT_WINDOWS:
        raise HTTPException(status_code=400, detail=f"unsupported window: {window!r}")
    try:
        return get_governance_audit_detail(db, correlation_id, window=win)
    except GovernanceAuditNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
