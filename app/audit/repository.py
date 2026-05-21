"""Persistence queries for audit_logs."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit.models import AuditLog


def insert_audit_log(db: Session, row: AuditLog) -> AuditLog:
    db.add(row)
    db.flush()
    return row


def count_audit_logs(
    db: Session,
    *,
    action: str | None = None,
    entity_type: str | None = None,
    result: str | None = None,
    since: datetime | None = None,
) -> int:
    q = select(func.count()).select_from(AuditLog)
    q = _apply_filters(q, action=action, entity_type=entity_type, result=result, since=since)
    return int(db.scalar(q) or 0)


def list_audit_logs(
    db: Session,
    *,
    action: str | None = None,
    entity_type: str | None = None,
    result: str | None = None,
    since: datetime | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[AuditLog]:
    q = select(AuditLog).order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    q = _apply_filters(q, action=action, entity_type=entity_type, result=result, since=since)
    q = q.offset(max(0, offset)).limit(min(500, max(1, limit)))
    return list(db.scalars(q))


def _apply_filters(q, *, action: str | None, entity_type: str | None, result: str | None, since: datetime | None):
    if action is not None:
        q = q.where(AuditLog.action == action)
    if entity_type is not None:
        q = q.where(AuditLog.entity_type == entity_type)
    if result is not None:
        q = q.where(AuditLog.result == result)
    if since is not None:
        q = q.where(AuditLog.created_at >= since)
    return q
