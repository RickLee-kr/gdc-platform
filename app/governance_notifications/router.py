"""Governance notifications REST API (M20.2)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth.governance_rbac import (
    ROLE_ADMINISTRATOR,
    ROLE_GOVERNANCE_AUDITOR,
    ROLE_GOVERNANCE_OPERATOR,
    require_roles,
)
from app.database import get_db, get_db_read_bounded
from app.governance_notifications.models import NOTIFICATION_STATUSES
from app.governance_notifications.schemas import (
    GovernanceNotificationConfigResponse,
    GovernanceNotificationConfigUpdateRequest,
    GovernanceNotificationEventsResponse,
    GovernanceNotificationHealthResponse,
    GovernanceNotificationTestRequest,
    GovernanceNotificationTestResponse,
)
from app.governance_notifications.service import NotificationService, NotificationServiceError

router = APIRouter()

_read_auth = Depends(
    require_roles(ROLE_ADMINISTRATOR, ROLE_GOVERNANCE_OPERATOR, ROLE_GOVERNANCE_AUDITOR)
)
_write_auth = Depends(require_roles(ROLE_ADMINISTRATOR))


@router.get("/notifications/config", response_model=GovernanceNotificationConfigResponse)
async def get_governance_notification_config(
    db: Session = Depends(get_db_read_bounded),
    _auth=_read_auth,
) -> GovernanceNotificationConfigResponse:
    return NotificationService.get_config(db)


@router.put("/notifications/config", response_model=GovernanceNotificationConfigResponse)
async def put_governance_notification_config(
    body: GovernanceNotificationConfigUpdateRequest,
    db: Session = Depends(get_db),
    _auth=_write_auth,
) -> GovernanceNotificationConfigResponse:
    result = NotificationService.update_config(db, body)
    db.commit()
    return result


@router.post("/notifications/test", response_model=GovernanceNotificationTestResponse)
async def post_governance_notification_test(
    body: GovernanceNotificationTestRequest,
    db: Session = Depends(get_db),
    _auth=_write_auth,
) -> GovernanceNotificationTestResponse:
    try:
        result = NotificationService.test_notification(db, channel=body.channel)
    except NotificationServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


@router.get("/notifications/events", response_model=GovernanceNotificationEventsResponse)
async def get_governance_notification_events(
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db_read_bounded),
    _auth=_read_auth,
) -> GovernanceNotificationEventsResponse:
    if status is not None and str(status).upper() not in NOTIFICATION_STATUSES:
        raise HTTPException(status_code=400, detail=f"unsupported status: {status!r}")
    return NotificationService.list_events(db, status=str(status).upper() if status else None, limit=limit)


@router.get("/notifications/health", response_model=GovernanceNotificationHealthResponse)
async def get_governance_notification_health(
    db: Session = Depends(get_db_read_bounded),
    _auth=_read_auth,
) -> GovernanceNotificationHealthResponse:
    return NotificationService.get_health(db)
