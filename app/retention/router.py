"""HTTP API for operational retention preview and execution."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, Request
from sqlalchemy.orm import Session

from app.auth.role_guard import (
    ROLE_ADMINISTRATOR,
    ROLE_OPERATOR,
    ROLE_VIEWER,
    require_roles,
    resolve_request_username,
)
from app.database import get_db
from app.platform_admin.repository import get_retention_policy_row
from app.retention.schemas import (
    RetentionPreviewItem,
    RetentionPreviewResponse,
    RetentionRunRequest,
    RetentionRunOutcomeItem,
    RetentionRunResponse,
    RetentionStatusResponse,
)
from app.retention.config import effective_retention_policies
from app.retention.service import ALL_TABLE_KEYS, preview_retention, run_operational_retention, last_operational_retention_audit_row

router = APIRouter()
UTC = timezone.utc


@router.get("/preview", response_model=RetentionPreviewResponse)
def get_retention_preview(
    db: Session = Depends(get_db),
    _role: str = Depends(require_roles(ROLE_ADMINISTRATOR, ROLE_OPERATOR, ROLE_VIEWER)),
) -> RetentionPreviewResponse:
    row = get_retention_policy_row(db)
    rows = preview_retention(db, row)
    return RetentionPreviewResponse(
        generated_at_utc=datetime.now(UTC),
        policies=effective_retention_policies(row),
        tables=[
            RetentionPreviewItem(
                table=r.table,
                rows_eligible=r.rows_eligible,
                oldest_row_timestamp=r.oldest_row_timestamp,
                retention_days=r.retention_days,
                cutoff_utc=r.cutoff_utc,
                notes=dict(r.notes or {}),
            )
            for r in rows
        ],
    )


@router.get("/status", response_model=RetentionStatusResponse)
def get_retention_status(
    db: Session = Depends(get_db),
    _role: str = Depends(require_roles(ROLE_ADMINISTRATOR, ROLE_OPERATOR, ROLE_VIEWER)),
) -> RetentionStatusResponse:
    row = get_retention_policy_row(db)
    meta = dict(row.operational_retention_meta or {})
    raw_next = meta.get("supplement_next_after")
    next_after: datetime | None = None
    if raw_next:
        try:
            next_after = datetime.fromisoformat(str(raw_next))
            if next_after.tzinfo is None:
                next_after = next_after.replace(tzinfo=UTC)
        except ValueError:
            next_after = None
    last_at_raw = meta.get("last_operational_retention_at")
    last_at: datetime | None = None
    if last_at_raw:
        try:
            last_at = datetime.fromisoformat(str(last_at_raw))
            if last_at.tzinfo is None:
                last_at = last_at.replace(tzinfo=UTC)
        except ValueError:
            last_at = None
    audit = last_operational_retention_audit_row(db)
    audit_doc: dict | None = None
    if audit is not None:
        audit_doc = {
            "id": int(audit.id),
            "created_at": audit.created_at,
            "actor_username": audit.actor_username,
            "details": dict(audit.details_json or {}),
        }
    return RetentionStatusResponse(
        policies=effective_retention_policies(row),
        supplement_next_after_utc=next_after,
        last_operational_retention_at=last_at,
        last_audit=audit_doc,
    )


@router.post("/run", response_model=RetentionRunResponse)
def post_retention_run(
    request: Request,
    payload: RetentionRunRequest | None = Body(None),
    db: Session = Depends(get_db),
    _role: str = Depends(require_roles(ROLE_ADMINISTRATOR, ROLE_OPERATOR)),
) -> RetentionRunResponse:
    row = get_retention_policy_row(db)
    body = payload if payload is not None else RetentionRunRequest()
    tset = None
    if body.tables is not None:
        tset = {str(x).strip() for x in body.tables if str(x).strip()}
        unknown = tset - ALL_TABLE_KEYS
        if unknown:
            tset -= unknown
    started = datetime.now(UTC)
    actor = resolve_request_username(request)
    outcomes = run_operational_retention(
        db,
        row,
        dry_run=body.dry_run,
        actor_username=actor,
        trigger="api",
        tables=tset,
    )
    return RetentionRunResponse(
        dry_run=body.dry_run,
        started_at_utc=started,
        outcomes=[
            RetentionRunOutcomeItem(
                table=o.table,
                status=o.status,
                matched_count=o.matched_count,
                deleted_count=o.deleted_count,
                retention_days=o.retention_days,
                cutoff_utc=o.cutoff_utc,
                duration_ms=o.duration_ms,
                message=o.message,
                notes=dict(o.notes or {}),
            )
            for o in outcomes
        ],
    )
