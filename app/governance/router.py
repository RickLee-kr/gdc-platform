"""Governance control plane REST API."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.governance_rbac import require_governance_dashboard_read, require_governance_read
from app.database import get_db_read_bounded
from app.governance.cache import get_governance_summary_cached
from app.governance.dashboard_cache import get_governance_dashboard_summary_cached
from app.governance.schemas import GovernanceDashboardSummaryResponse, GovernanceSummaryResponse
from app.governance_approval.router import router as governance_approval_router
from app.governance_audit.router import router as governance_audit_router
from app.governance_policies.router import router as governance_policies_router
from app.governance_quarantine.router import router as governance_quarantine_router
from app.governance_operations.router import router as governance_operations_router
from app.governance_notifications.router import router as governance_notifications_router
from app.governance_replay.router import router as governance_replay_router
from app.governance_violations.router import router as governance_violations_router

router = APIRouter()
router.include_router(governance_policies_router)
router.include_router(governance_approval_router)
router.include_router(governance_violations_router)
router.include_router(governance_quarantine_router)
router.include_router(governance_audit_router)
router.include_router(governance_operations_router)
router.include_router(governance_replay_router)
router.include_router(governance_notifications_router)


@router.get("/dashboard/summary", response_model=GovernanceDashboardSummaryResponse)
async def get_governance_dashboard_summary_endpoint(
    db: Session = Depends(get_db_read_bounded),
    _auth=Depends(require_governance_dashboard_read()),
) -> GovernanceDashboardSummaryResponse:
    return get_governance_dashboard_summary_cached(db)


@router.get("/summary", response_model=GovernanceSummaryResponse)
async def get_governance_summary(
    db: Session = Depends(get_db_read_bounded),
    _auth=Depends(require_governance_read()),
) -> GovernanceSummaryResponse:
    return get_governance_summary_cached(db)
