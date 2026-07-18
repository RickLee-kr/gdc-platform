"""Append-only audit trail and monotonic config version markers (same-transaction helpers)."""

from __future__ import annotations

import copy
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit.service import record_audit_log
from app.platform_admin.models import PlatformAuditEvent, PlatformConfigVersion
from app.security.secrets import mask_secrets_and_pem


def record_audit_event(
    db: Session,
    *,
    action: str,
    actor_username: str | None = None,
    entity_type: str | None = None,
    entity_id: int | None = None,
    entity_name: str | None = None,
    details: dict[str, Any] | None = None,
    result: str = "success",
    actor_user_id: int | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    request: Any = None,
) -> None:
    """Record audit via audit_logs + legacy platform_audit_events.

    When ``request`` is provided and ``actor_username`` is omitted, the
    authenticated request actor is used (not the placeholder ``system``).
    """
    from app.audit.service import audit_actor_from_request

    resolved_username = actor_username
    resolved_user_id = actor_user_id
    resolved_ip = ip_address
    resolved_ua = user_agent
    if request is not None:
        actor = audit_actor_from_request(request, fallback_username=actor_username or "system")
        if resolved_username is None:
            resolved_username = actor.actor_username
        if resolved_user_id is None:
            resolved_user_id = actor.actor_user_id
        if resolved_ip is None:
            resolved_ip = actor.ip_address
        if resolved_ua is None:
            resolved_ua = actor.user_agent
    resolved_username = resolved_username or "system"

    meta = dict(details or {})
    if entity_name:
        meta["entity_name"] = entity_name
    sanitized_details = mask_secrets_and_pem(dict(details or {}))
    record_audit_log(
        db,
        action=action,
        result=result,
        actor_user_id=resolved_user_id,
        actor_username=resolved_username,
        entity_type=entity_type,
        entity_id=entity_id,
        metadata=meta,
        ip_address=resolved_ip,
        user_agent=resolved_ua,
        request=request,
    )
    # Legacy admin UI still reads platform_audit_events until fully migrated.
    db.add(
        PlatformAuditEvent(
            actor_username=resolved_username,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=entity_name,
            details_json=sanitized_details if isinstance(sanitized_details, dict) else {},
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
