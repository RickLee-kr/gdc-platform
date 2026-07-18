"""Governance replay REST API (M20.1 Replay Operations Center)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.auth.governance_rbac import require_governance_read, require_replay_action
from app.database import get_db, get_db_read_bounded
from app.governance_replay.models import REPLAY_DISPLAY_STATUSES, REPLAY_WINDOWS
from app.governance_replay.schemas import (
    GovernanceReplayBulkRequest,
    GovernanceReplayBulkResponse,
    GovernanceReplayDetailResponse,
    GovernanceReplayExecuteResponse,
    GovernanceReplayListResponse,
)
from app.governance_replay.service import (
    GovernanceReplayNotFoundError,
    bulk_execute_governance_replay,
    execute_governance_replay,
    get_governance_replay_detail,
    list_governance_replay_events,
)
from app.platform_admin import journal

router = APIRouter()


@router.get("/replay", response_model=GovernanceReplayListResponse)
async def get_governance_replay_events(
    window: str = Query(default="24h"),
    policy_id: int | None = Query(default=None),
    stream_id: int | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db_read_bounded),
    _auth=Depends(require_governance_read()),
) -> GovernanceReplayListResponse:
    win = str(window).strip().lower()
    if win not in REPLAY_WINDOWS:
        raise HTTPException(status_code=400, detail=f"unsupported window: {window!r}")

    if status is not None and str(status).upper() not in REPLAY_DISPLAY_STATUSES:
        raise HTTPException(status_code=400, detail=f"unsupported status: {status!r}")

    st = str(status).upper() if status is not None else None
    events, queue_count, failed_count, recent_count, window_total, filtered_total = list_governance_replay_events(
        db,
        window=win,
        policy_id=policy_id,
        stream_id=stream_id,
        status=st,
        limit=limit,
    )
    return GovernanceReplayListResponse(
        window=win,
        total=len(events),
        window_total=window_total,
        filtered_total=filtered_total,
        replay_events=events,
        queue_count=queue_count,
        failed_count=failed_count,
        recent_count=recent_count,
    )


@router.post("/replay/bulk-execute", response_model=GovernanceReplayBulkResponse)
async def bulk_execute_governance_replay_events(
    payload: GovernanceReplayBulkRequest,
    request: Request,
    db: Session = Depends(get_db),
    _auth=Depends(require_replay_action()),
) -> GovernanceReplayBulkResponse:
    if not payload.ids:
        raise HTTPException(status_code=400, detail="ids must not be empty")
    result = bulk_execute_governance_replay(db, payload.ids)
    executed_ids = [item.id for item in result.results]
    journal.record_audit_event(
        db,
        action="GOVERNANCE_REPLAY_BULK_EXECUTE",
        entity_type="REPLAY_EVENT",
        entity_id=executed_ids[0] if len(executed_ids) == 1 else None,
        details={
            "affected_count": result.total,
            "succeeded": result.succeeded,
            "failed": result.failed,
            "ids": executed_ids,
            "success": result.failed == 0,
        },
        result="success" if result.failed == 0 else "partial_failure",
        request=request,
    )
    db.commit()
    return result


@router.get("/replay/{replay_id}", response_model=GovernanceReplayDetailResponse)
async def get_governance_replay_by_id(
    replay_id: int,
    window: str = Query(default="30d"),
    db: Session = Depends(get_db_read_bounded),
    _auth=Depends(require_governance_read()),
) -> GovernanceReplayDetailResponse:
    win = str(window).strip().lower()
    if win not in REPLAY_WINDOWS:
        raise HTTPException(status_code=400, detail=f"unsupported window: {window!r}")
    try:
        return get_governance_replay_detail(db, replay_id, window=win)
    except GovernanceReplayNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/replay/{replay_id}/execute", response_model=GovernanceReplayExecuteResponse)
async def execute_governance_replay_event(
    replay_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _auth=Depends(require_replay_action()),
) -> GovernanceReplayExecuteResponse:
    try:
        result = execute_governance_replay(db, replay_id)
    except GovernanceReplayNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    journal.record_audit_event(
        db,
        action="GOVERNANCE_REPLAY_EXECUTE",
        entity_type="REPLAY_EVENT",
        entity_id=int(replay_id),
        details={
            "affected_count": 1,
            "outcome": result.outcome,
            "status": result.status,
            "message": result.message,
            "success": result.outcome == "replayed",
        },
        result="success" if result.outcome == "replayed" else "failure",
        request=request,
    )
    db.commit()
    return result
