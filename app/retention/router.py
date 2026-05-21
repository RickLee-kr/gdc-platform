"""HTTP API for operational retention preview and execution."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.auth.role_guard import (
    ROLE_ADMINISTRATOR,
    ROLE_OPERATOR,
    ROLE_VIEWER,
    require_roles,
    resolve_request_username,
)
from app.database import get_db
from app.platform_admin.repository import get_retention_policy_row
from app.db.partition_archive import build_delivery_log_archive_targets
from app.db.partition_maintenance import build_partition_observability
from app.db.partition_maintenance_scheduler import get_partition_maintenance_scheduler
from app.retention.schemas import (
    PartitionObservabilityResponse,
    PartitionStatusItem,
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
        execution_config={
            "destructive_actions_enabled": bool(settings.GDC_RETENTION_DESTRUCTIVE_ACTIONS_ENABLED),
            "production_deletes_enabled": bool(settings.GDC_RETENTION_PRODUCTION_DELETES_ENABLED),
            "automatic_deletes_enabled": bool(settings.GDC_RETENTION_AUTOMATIC_DELETES_ENABLED),
            "delivery_log_partition_drop_enabled": bool(settings.GDC_RETENTION_DELIVERY_LOG_PARTITION_DROP_ENABLED),
            "runtime_snapshot_cleanup_enabled": bool(settings.GDC_RUNTIME_AGGREGATE_SNAPSHOT_CLEANUP_ENABLED),
        },
        supplement_next_after_utc=next_after,
        last_operational_retention_at=last_at,
        last_audit=audit_doc,
    )


@router.get("/partitions", response_model=PartitionObservabilityResponse)
def get_partition_observability(
    db: Session = Depends(get_db),
    _role: str = Depends(require_roles(ROLE_ADMINISTRATOR, ROLE_OPERATOR, ROLE_VIEWER)),
) -> PartitionObservabilityResponse:
    row = get_retention_policy_row(db)
    pol = effective_retention_policies(row)
    sched = get_partition_maintenance_scheduler()
    last_maint: dict = {}
    if sched is not None and sched.last_result() is not None:
        lr = sched.last_result()
        last_maint = {
            "status": lr.status,
            "message": lr.message,
            "ensured_partitions": list(lr.ensured_partitions),
            "orphan_partitions": list(lr.orphan_partitions),
            "failures": list(lr.failures),
            "last_tick_at": sched.last_tick_at().isoformat() if sched.last_tick_at() else None,
        }
    snap = build_partition_observability(
        db,
        retention_days=pol["delivery_logs_days"],
        checkpoint_history_retention_days=pol.get("checkpoint_history_days", pol["delivery_logs_days"]),
        last_maintenance=last_maint,
    )
    archive_plan = build_delivery_log_archive_targets(db, retention_days=pol["delivery_logs_days"])
    return PartitionObservabilityResponse(
        generated_at_utc=snap.generated_at_utc,
        delivery_logs_partitioned=snap.delivery_logs_partitioned,
        partition_key=snap.partition_key,
        partitions=[
            PartitionStatusItem(
                table_name=p.table_name,
                partition_name=p.partition_name,
                month_start=p.month_start.isoformat() if p.month_start else None,
                row_count=p.row_count,
                is_protected=p.is_protected,
                is_default=p.is_default,
            )
            for p in snap.partitions
        ],
        protected_months=list(snap.protected_months),
        oldest_partition=snap.oldest_partition,
        newest_partition=snap.newest_partition,
        orphan_partitions=list(snap.orphan_partitions),
        retention_days=snap.retention_days,
        checkpoint_history_retention_days=snap.checkpoint_history_retention_days,
        archive_plan_notes=dict(archive_plan.notes),
        last_maintenance=dict(snap.last_maintenance),
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
