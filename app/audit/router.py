"""Read API for operator/admin audit logs."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.audit.repository import count_audit_logs, list_audit_logs
from app.audit.schemas import AuditLogListResponse, AuditLogRead
from app.audit.service import audit_log_to_read
from app.database import get_db_read_bounded

router = APIRouter()


@router.get("", response_model=AuditLogListResponse)
@router.get("/", response_model=AuditLogListResponse, include_in_schema=False)
def list_audit_log_entries(
    db: Session = Depends(get_db_read_bounded),
    action: str | None = Query(None, max_length=64),
    entity_type: str | None = Query(None, max_length=64),
    result: str | None = Query(None, max_length=16),
    since: datetime | None = Query(None, description="ISO timestamp; return rows at or after this time"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> AuditLogListResponse:
    total = count_audit_logs(
        db,
        action=action,
        entity_type=entity_type,
        result=result,
        since=since,
    )
    rows = list_audit_logs(
        db,
        action=action,
        entity_type=entity_type,
        result=result,
        since=since,
        limit=limit,
        offset=offset,
    )
    items = [AuditLogRead.model_validate(audit_log_to_read(r)) for r in rows]
    return AuditLogListResponse(total=total, items=items)
