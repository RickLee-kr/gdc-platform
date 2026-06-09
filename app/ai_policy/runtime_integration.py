"""Runtime hooks for AI policy enforcement in AI_PROVIDER_POST."""

from __future__ import annotations

from typing import Any, Callable

from sqlalchemy.orm import Session

from app.ai_audit.service import AiAuditContext, record_inspection_audit
from app.ai_governance.service import record_policy_violation
from app.ai_policy.enforcement import (
    enforce_prompt_policy,
    enforce_response_policy,
    inspection_log_fields,
)
from app.ai_policy.errors import AiPolicyEnforcementError
from app.ai_policy.inspection import inspect_prompt, inspect_response
from app.ai_streams.models import AiStream


def resolve_ai_stream_id(db: Session | None, *, stream_id: int | None) -> int | None:
    if db is None or stream_id is None:
        return None
    row = db.query(AiStream).filter(AiStream.stream_id == int(stream_id)).first()
    if row is None:
        return None
    return int(row.id)


def _audit_context_from_kwargs(
    *,
    stream_id: int | None,
    ai_stream_id: int | None,
    audit_ctx: dict[str, Any] | None,
) -> AiAuditContext | None:
    if not isinstance(audit_ctx, dict):
        return None
    request_id = audit_ctx.get("request_id")
    if not request_id:
        return None
    return AiAuditContext(
        request_id=str(request_id),
        stream_id=stream_id,
        ai_stream_id=ai_stream_id,
        ai_provider_id=int(audit_ctx["ai_provider_id"]) if audit_ctx.get("ai_provider_id") is not None else None,
        provider=str(audit_ctx["provider"]) if audit_ctx.get("provider") else None,
        model=str(audit_ctx["model"]) if audit_ctx.get("model") else None,
    )


def enforce_prompt_before_provider(
    db: Session | None,
    *,
    ai_stream_id: int | None,
    provider_request: dict[str, Any],
    log_fn: Callable[[dict[str, Any]], None] | None = None,
    stream_id: int | None = None,
    audit_ctx: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if db is None or ai_stream_id is None:
        return provider_request
    inspection = inspect_prompt(db, ai_stream_id=int(ai_stream_id), provider_request=provider_request)
    ctx = _audit_context_from_kwargs(stream_id=stream_id, ai_stream_id=ai_stream_id, audit_ctx=audit_ctx)
    if log_fn is not None:
        log_fn(
            inspection_log_fields(
                inspection,
                stream_id=stream_id,
                request_id=ctx.request_id if ctx is not None else None,
            )
        )
    if ctx is not None:
        record_inspection_audit(db, inspection, ctx=ctx)
        record_policy_violation(
            db,
            inspection,
            request_id=ctx.request_id,
            stream_id=stream_id,
            ai_stream_id=ai_stream_id,
            ai_provider_id=ctx.ai_provider_id,
            provider=ctx.provider,
        )
    return enforce_prompt_policy(
        db,
        ai_stream_id=int(ai_stream_id),
        provider_request=provider_request,
        inspection=inspection,
    )


def enforce_response_after_provider(
    db: Session | None,
    *,
    ai_stream_id: int | None,
    provider_response: dict[str, Any],
    log_fn: Callable[[dict[str, Any]], None] | None = None,
    stream_id: int | None = None,
    audit_ctx: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if db is None or ai_stream_id is None:
        return provider_response
    inspection = inspect_response(db, ai_stream_id=int(ai_stream_id), provider_response=provider_response)
    ctx = _audit_context_from_kwargs(stream_id=stream_id, ai_stream_id=ai_stream_id, audit_ctx=audit_ctx)
    if log_fn is not None:
        log_fn(
            inspection_log_fields(
                inspection,
                stream_id=stream_id,
                request_id=ctx.request_id if ctx is not None else None,
            )
        )
    if ctx is not None:
        record_inspection_audit(db, inspection, ctx=ctx)
        record_policy_violation(
            db,
            inspection,
            request_id=ctx.request_id,
            stream_id=stream_id,
            ai_stream_id=ai_stream_id,
            ai_provider_id=ctx.ai_provider_id,
            provider=ctx.provider,
        )
    return enforce_response_policy(
        db,
        ai_stream_id=int(ai_stream_id),
        provider_response=provider_response,
        inspection=inspection,
    )


__all__ = [
    "AiPolicyEnforcementError",
    "enforce_prompt_before_provider",
    "enforce_response_after_provider",
    "resolve_ai_stream_id",
]
