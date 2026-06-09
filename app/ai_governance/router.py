"""AI governance REST API (M24)."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.ai_governance.schemas import (
    AiGovernanceDashboardSummary,
    AiGovernancePolicyImpact,
    AiGovernanceWorkflowNote,
    AiPolicyViolationListResponse,
    AiPolicyViolationRead,
)
from app.ai_governance.service import (
    AiPolicyViolationNotFoundError,
    AiPolicyViolationStateError,
    acknowledge_ai_policy_violation,
    build_ai_governance_dashboard,
    build_policy_impact_analysis,
    get_ai_policy_violation,
    list_ai_policy_violations,
    normalize_status_filter,
    resolve_ai_policy_violation,
)
from app.auth.governance_rbac import resolve_governance_actor
from app.database import get_db, get_db_read_bounded

router = APIRouter()


@router.get("/violations", response_model=AiPolicyViolationListResponse)
async def get_ai_policy_violations(
    status: str | None = Query(default="open"),
    provider: str | None = Query(default=None),
    ai_stream_id: int | None = Query(default=None),
    policy_rule_id: int | None = Query(default=None),
    request_id: str | None = Query(default=None),
    created_from: datetime | None = Query(default=None),
    created_to: datetime | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db_read_bounded),
) -> AiPolicyViolationListResponse:
    try:
        status_filter = normalize_status_filter(status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    rows = list_ai_policy_violations(
        db,
        status_filter=status_filter,
        provider=provider,
        ai_stream_id=ai_stream_id,
        policy_rule_id=policy_rule_id,
        request_id=request_id,
        created_from=created_from,
        created_to=created_to,
        limit=limit,
    )
    return AiPolicyViolationListResponse(
        total=len(rows),
        violations=[AiPolicyViolationRead.model_validate(row) for row in rows],
    )


@router.get("/violations/{violation_id}", response_model=AiPolicyViolationRead)
async def get_ai_policy_violation_detail(
    violation_id: int,
    db: Session = Depends(get_db_read_bounded),
) -> AiPolicyViolationRead:
    try:
        row = get_ai_policy_violation(db, violation_id)
    except AiPolicyViolationNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return AiPolicyViolationRead.model_validate(row)


@router.post("/violations/{violation_id}/acknowledge", response_model=AiPolicyViolationRead)
async def post_acknowledge_ai_policy_violation(
    violation_id: int,
    payload: AiGovernanceWorkflowNote,
    request: Request,
    db: Session = Depends(get_db),
) -> AiPolicyViolationRead:
    actor = resolve_governance_actor(request)
    try:
        row = acknowledge_ai_policy_violation(
            db,
            violation_id=violation_id,
            actor_username=actor,
            note=payload.note,
        )
    except AiPolicyViolationNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AiPolicyViolationStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    db.commit()
    db.refresh(row)
    return AiPolicyViolationRead.model_validate(row)


@router.post("/violations/{violation_id}/resolve", response_model=AiPolicyViolationRead)
async def post_resolve_ai_policy_violation(
    violation_id: int,
    payload: AiGovernanceWorkflowNote,
    request: Request,
    db: Session = Depends(get_db),
) -> AiPolicyViolationRead:
    actor = resolve_governance_actor(request)
    try:
        row = resolve_ai_policy_violation(
            db,
            violation_id=violation_id,
            actor_username=actor,
            note=payload.note,
        )
    except AiPolicyViolationNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AiPolicyViolationStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    db.commit()
    db.refresh(row)
    return AiPolicyViolationRead.model_validate(row)


@router.get("/dashboard/summary", response_model=AiGovernanceDashboardSummary)
async def get_ai_governance_dashboard_summary(
    hours: int = Query(default=24, ge=1, le=168),
    stream_id: int | None = Query(default=None),
    provider_id: int | None = Query(default=None, alias="provider"),
    db: Session = Depends(get_db_read_bounded),
) -> AiGovernanceDashboardSummary:
    payload = build_ai_governance_dashboard(
        db,
        hours=hours,
        stream_id=stream_id,
        provider_id=provider_id,
    )
    return AiGovernanceDashboardSummary.model_validate(payload)


@router.get("/policy-impact", response_model=list[AiGovernancePolicyImpact])
async def get_ai_governance_policy_impact(
    hours: int = Query(default=24, ge=1, le=168),
    stream_id: int | None = Query(default=None),
    provider_id: int | None = Query(default=None, alias="provider"),
    db: Session = Depends(get_db_read_bounded),
) -> list[AiGovernancePolicyImpact]:
    rows = build_policy_impact_analysis(
        db,
        hours=hours,
        stream_id=stream_id,
        provider_id=provider_id,
    )
    return [AiGovernancePolicyImpact.model_validate(row) for row in rows]
