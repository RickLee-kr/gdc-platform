"""Governance Operations Center REST API (M19.6)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.governance_rbac import require_governance_operations_access
from app.database import get_db_read_bounded
from app.governance_operations.schemas import (
    ACTIVITY_LIMIT_DEFAULT,
    ACTIVITY_LIMIT_MAX,
    GovernanceOperationsActivityResponse,
    GovernanceOperationsAttentionResponse,
    GovernanceOperationsQueueResponse,
    GovernanceOperationsSummaryResponse,
)
from app.governance_operations.service import (
    get_governance_operations_activity,
    get_governance_operations_attention,
    get_governance_operations_queue,
    get_governance_operations_summary,
)

router = APIRouter()

_ops_auth = Depends(require_governance_operations_access())


@router.get("/operations/summary", response_model=GovernanceOperationsSummaryResponse)
async def get_operations_summary(
    db: Session = Depends(get_db_read_bounded),
    _auth=_ops_auth,
) -> GovernanceOperationsSummaryResponse:
    return get_governance_operations_summary(db)


@router.get("/operations/queue", response_model=GovernanceOperationsQueueResponse)
async def get_operations_queue(
    db: Session = Depends(get_db_read_bounded),
    _auth=_ops_auth,
) -> GovernanceOperationsQueueResponse:
    return get_governance_operations_queue(db)


@router.get("/operations/attention", response_model=GovernanceOperationsAttentionResponse)
async def get_operations_attention(
    db: Session = Depends(get_db_read_bounded),
    _auth=_ops_auth,
) -> GovernanceOperationsAttentionResponse:
    return get_governance_operations_attention(db)


@router.get("/operations/activity", response_model=GovernanceOperationsActivityResponse)
async def get_operations_activity(
    limit: int = Query(default=ACTIVITY_LIMIT_DEFAULT, ge=1, le=ACTIVITY_LIMIT_MAX),
    db: Session = Depends(get_db_read_bounded),
    _auth=_ops_auth,
) -> GovernanceOperationsActivityResponse:
    return get_governance_operations_activity(db, limit=limit)
