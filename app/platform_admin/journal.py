"""Append-only audit trail and monotonic config version markers (same-transaction helpers)."""

from __future__ import annotations

import copy
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.platform_admin.models import PlatformAuditEvent, PlatformConfigVersion


def record_audit_event(
    db: Session,
    *,
    action: str,
    actor_username: str = "system",
    entity_type: str | None = None,
    entity_id: int | None = None,
    entity_name: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    db.add(
        PlatformAuditEvent(
            actor_username=actor_username,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=entity_name,
            details_json=dict(details or {}),
        )
    )
    db.flush()


def record_config_version(
    db: Session,
    *,
    entity_type: str,
    entity_id: int,
    entity_name: str | None = None,
    changed_by: str = "system",
    summary: str | None = None,
    snapshot_before: dict[str, Any] | None = None,
    snapshot_after: dict[str, Any] | None = None,
) -> int:
    cur = db.scalar(select(func.coalesce(func.max(PlatformConfigVersion.version), 0)))
    nxt = int(cur or 0) + 1
    db.add(
        PlatformConfigVersion(
            version=nxt,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=entity_name,
            changed_by=changed_by,
            summary=summary,
            snapshot_before_json=copy.deepcopy(snapshot_before) if snapshot_before is not None else None,
            snapshot_after_json=copy.deepcopy(snapshot_after) if snapshot_after is not None else None,
        )
    )
    db.flush()
    return nxt
