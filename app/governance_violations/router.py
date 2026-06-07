"""Governance violation REST API (M19.1 Violation Center)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth.governance_rbac import require_governance_read
from app.database import get_db_read_bounded
from app.governance_violations.models import VIOLATION_SEVERITIES, VIOLATION_STATUSES, VIOLATION_WINDOWS
from app.governance_violations.schemas import GovernanceViolationDetailResponse, GovernanceViolationListResponse
from app.governance_violations.service import (
    GovernanceViolationNotFoundError,
    get_governance_violation_detail,
    list_governance_violations,
)

router = APIRouter()


@router.get("/violations", response_model=GovernanceViolationListResponse)
async def get_governance_violations(
    window: str = Query(default="24h"),
    policy_id: int | None = Query(default=None),
    stream_id: int | None = Query(default=None),
    severity: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db_read_bounded),
    _auth=Depends(require_governance_read()),
) -> GovernanceViolationListResponse:
    win = str(window).strip().lower()
    if win not in VIOLATION_WINDOWS:
        raise HTTPException(status_code=400, detail=f"unsupported window: {window!r}")

    if severity is not None and str(severity).upper() not in VIOLATION_SEVERITIES:
        raise HTTPException(status_code=400, detail=f"unsupported severity: {severity!r}")
    if status is not None and str(status).upper() not in VIOLATION_STATUSES:
        raise HTTPException(status_code=400, detail=f"unsupported status: {status!r}")

    sev = str(severity).upper() if severity is not None else None
    st = str(status).upper() if status is not None else None

    violations = list_governance_violations(
        db,
        window=win,
        policy_id=policy_id,
        stream_id=stream_id,
        severity=sev,
        status=st,
        limit=limit,
    )
    return GovernanceViolationListResponse(window=win, total=len(violations), violations=violations)


@router.get("/violations/{violation_id}", response_model=GovernanceViolationDetailResponse)
async def get_governance_violation_by_id(
    violation_id: str,
    window: str = Query(default="30d"),
    db: Session = Depends(get_db_read_bounded),
    _auth=Depends(require_governance_read()),
) -> GovernanceViolationDetailResponse:
    win = str(window).strip().lower()
    if win not in VIOLATION_WINDOWS:
        raise HTTPException(status_code=400, detail=f"unsupported window: {window!r}")
    try:
        return get_governance_violation_detail(db, violation_id, window=win)
    except GovernanceViolationNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
