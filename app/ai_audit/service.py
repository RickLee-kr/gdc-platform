"""AI audit recording, query, and correlation (M23)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai_audit.models import (
    AI_AUDIT_EVENT_PROMPT_BLOCKED,
    AI_AUDIT_EVENT_PROMPT_INSPECTED,
    AI_AUDIT_EVENT_PROMPT_MASKED,
    AI_AUDIT_EVENT_RESPONSE_BLOCKED,
    AI_AUDIT_EVENT_RESPONSE_INSPECTED,
    AI_AUDIT_EVENT_RESPONSE_MASKED,
    AI_AUDIT_EVENT_TYPES,
    AiAuditEvent,
)
from app.ai_policy.inspection import AiInspectionResult
from app.ai_policy.models import (
    AI_POLICY_ACTION_BLOCK,
    AI_POLICY_ACTION_DENY,
    AI_POLICY_ACTION_MASK,
    AI_POLICY_ACTION_REDACT,
    AI_POLICY_INSPECTION_KEYWORD,
    AI_POLICY_INSPECTION_REGEX,
    AI_POLICY_TARGET_PROMPT,
    AI_POLICY_TARGET_RESPONSE,
    AiPolicyRule,
)
from app.logs.models import DeliveryLog
from app.protection.policy_engine import AiPolicyMatch


class AiAuditNotFoundError(LookupError):
    """Raised when no audit events exist for a request_id."""


@dataclass(frozen=True)
class AiAuditContext:
    request_id: str
    stream_id: int | None = None
    ai_stream_id: int | None = None
    ai_provider_id: int | None = None
    provider: str | None = None
    model: str | None = None


def _top_match(inspection: AiInspectionResult) -> AiPolicyMatch | None:
    decision = str(inspection.policy.decision)
    for item in inspection.policy.matched_policies:
        if str(item.action_type) == decision:
            return item
    if inspection.policy.matched_policies:
        return inspection.policy.matched_policies[-1]
    return None


def _resolve_event_type(*, target: str, action: str) -> str:
    tgt = str(target).strip().lower()
    act = str(action).strip().lower()
    if tgt == AI_POLICY_TARGET_PROMPT:
        if act in {AI_POLICY_ACTION_BLOCK, AI_POLICY_ACTION_DENY}:
            return AI_AUDIT_EVENT_PROMPT_BLOCKED
        if act in {AI_POLICY_ACTION_MASK, AI_POLICY_ACTION_REDACT}:
            return AI_AUDIT_EVENT_PROMPT_MASKED
        return AI_AUDIT_EVENT_PROMPT_INSPECTED
    if act in {AI_POLICY_ACTION_BLOCK, AI_POLICY_ACTION_DENY}:
        return AI_AUDIT_EVENT_RESPONSE_BLOCKED
    if act in {AI_POLICY_ACTION_MASK, AI_POLICY_ACTION_REDACT}:
        return AI_AUDIT_EVENT_RESPONSE_MASKED
    return AI_AUDIT_EVENT_RESPONSE_INSPECTED


def _matched_pattern_for_match(
    match: AiPolicyMatch | None,
    *,
    db: Session | None,
    findings: list[dict[str, Any]],
) -> str | None:
    if match is None:
        if findings:
            pattern = findings[0].get("pattern")
            if pattern is not None:
                return str(pattern)
            matched_rule = findings[0].get("matched_rule")
            if matched_rule is not None:
                return str(matched_rule)
        return None
    inspection_type = str(match.inspection_type)
    if db is not None:
        rule = db.get(AiPolicyRule, int(match.policy_id))
        if rule is not None and isinstance(rule.condition_json, dict):
            condition = rule.condition_json
            if inspection_type == AI_POLICY_INSPECTION_REGEX:
                pattern = condition.get("pattern")
                return str(pattern) if pattern else None
            if inspection_type == AI_POLICY_INSPECTION_KEYWORD:
                keyword = condition.get("keyword")
                return str(keyword) if keyword else None
    if findings:
        for item in findings:
            if str(item.get("sensitivity_class", "")) and inspection_type in {
                "pii",
                "secret_pattern",
                "sensitive_content",
            }:
                seg = item.get("matched_segment") or item.get("pattern")
                if seg:
                    return str(seg)
    return inspection_type or None


def record_inspection_audit(
    db: Session | None,
    inspection: AiInspectionResult,
    *,
    ctx: AiAuditContext,
) -> AiAuditEvent | None:
    """Persist an audit event for a completed inspection (no raw text)."""

    if db is None or not ctx.request_id:
        return None
    action = str(inspection.policy.decision)
    top = _top_match(inspection)
    event_type = _resolve_event_type(target=inspection.target, action=action)
    row = AiAuditEvent(
        stream_id=ctx.stream_id,
        ai_provider_id=ctx.ai_provider_id,
        ai_stream_id=ctx.ai_stream_id,
        request_id=str(ctx.request_id),
        event_type=event_type,
        policy_rule_id=int(top.policy_id) if top is not None else None,
        action=action,
        matched_rule=str(top.policy_name) if top is not None else None,
        matched_pattern=_matched_pattern_for_match(top, db=db, findings=inspection.findings),
        provider=ctx.provider,
        model=ctx.model,
    )
    db.add(row)
    db.flush()
    return row


def list_ai_audit_events(
    db: Session,
    *,
    provider_id: int | None = None,
    stream_id: int | None = None,
    action: str | None = None,
    event_type: str | None = None,
    request_id: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    limit: int = 100,
) -> list[AiAuditEvent]:
    stmt = select(AiAuditEvent).order_by(AiAuditEvent.created_at.desc(), AiAuditEvent.id.desc())
    if provider_id is not None:
        stmt = stmt.where(AiAuditEvent.ai_provider_id == int(provider_id))
    if stream_id is not None:
        stmt = stmt.where(AiAuditEvent.stream_id == int(stream_id))
    if action is not None:
        stmt = stmt.where(AiAuditEvent.action == str(action).strip().lower())
    if event_type is not None:
        stmt = stmt.where(AiAuditEvent.event_type == str(event_type).strip().upper())
    if request_id is not None:
        stmt = stmt.where(AiAuditEvent.request_id == str(request_id).strip())
    if created_from is not None:
        stmt = stmt.where(AiAuditEvent.created_at >= created_from)
    if created_to is not None:
        stmt = stmt.where(AiAuditEvent.created_at <= created_to)
    stmt = stmt.limit(max(1, min(int(limit), 500)))
    return list(db.execute(stmt).scalars())


def correlate_ai_audit_request(db: Session, request_id: str) -> dict[str, Any]:
    """Join audit events with delivery logs for a single request_id."""

    rid = str(request_id).strip()
    events = list_ai_audit_events(db, request_id=rid, limit=200)
    if not events:
        raise AiAuditNotFoundError(f"no ai audit events for request_id={rid!r}")

    first = events[-1]
    stream_id = first.stream_id
    delivery_logs: list[DeliveryLog] = []
    if stream_id is not None:
        rows = list(
            db.execute(
                select(DeliveryLog)
                .where(
                    DeliveryLog.stream_id == int(stream_id),
                    DeliveryLog.payload_sample.op("->>")("request_id") == rid,
                )
                .order_by(DeliveryLog.created_at.asc(), DeliveryLog.id.asc())
            ).scalars()
        )
        delivery_logs = rows

    policy_rule_ids = sorted({int(e.policy_rule_id) for e in events if e.policy_rule_id is not None})
    return {
        "request_id": rid,
        "stream_id": first.stream_id,
        "ai_stream_id": first.ai_stream_id,
        "ai_provider_id": first.ai_provider_id,
        "provider": first.provider,
        "model": first.model,
        "policy_rule_ids": policy_rule_ids,
        "events": events,
        "delivery_logs": delivery_logs,
    }


def _window_start(hours: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(hours=max(1, min(int(hours), 168)))


def _empty_bucket() -> dict[str, int]:
    return {
        "inspected_count": 0,
        "blocked_count": 0,
        "masked_count": 0,
        "redacted_count": 0,
        "prompt_mask_count": 0,
        "response_mask_count": 0,
    }


def _accumulate_bucket(bucket: dict[str, int], row: AiAuditEvent) -> None:
    event_type = str(row.event_type)
    action = str(row.action)
    if event_type.endswith("_INSPECTED"):
        bucket["inspected_count"] += 1
    if event_type.endswith("_BLOCKED"):
        bucket["blocked_count"] += 1
    if event_type.endswith("_MASKED"):
        bucket["masked_count"] += 1
        if event_type == AI_AUDIT_EVENT_PROMPT_MASKED:
            bucket["prompt_mask_count"] += 1
        elif event_type == AI_AUDIT_EVENT_RESPONSE_MASKED:
            bucket["response_mask_count"] += 1
    if action == AI_POLICY_ACTION_REDACT:
        bucket["redacted_count"] += 1


def build_ai_audit_metrics(
    db: Session,
    *,
    hours: int = 24,
    stream_id: int | None = None,
    provider_id: int | None = None,
) -> dict[str, Any]:
    since = _window_start(hours)
    stmt = select(AiAuditEvent).where(AiAuditEvent.created_at >= since)
    if stream_id is not None:
        stmt = stmt.where(AiAuditEvent.stream_id == int(stream_id))
    if provider_id is not None:
        stmt = stmt.where(AiAuditEvent.ai_provider_id == int(provider_id))
    rows = list(db.execute(stmt).scalars())

    totals = _empty_bucket()
    by_provider: dict[int, dict[str, int]] = {}
    by_stream: dict[int, dict[str, int]] = {}

    for row in rows:
        _accumulate_bucket(totals, row)
        if row.ai_provider_id is not None:
            bucket = by_provider.setdefault(int(row.ai_provider_id), _empty_bucket())
            _accumulate_bucket(bucket, row)
        if row.stream_id is not None:
            bucket = by_stream.setdefault(int(row.stream_id), _empty_bucket())
            _accumulate_bucket(bucket, row)

    return {
        "window_hours": int(hours),
        "totals": totals,
        "by_provider": [
            {"provider_id": pid, **bucket} for pid, bucket in sorted(by_provider.items())
        ],
        "by_stream": [
            {"stream_id": sid, **bucket} for sid, bucket in sorted(by_stream.items())
        ],
    }


__all__ = [
    "AI_AUDIT_EVENT_TYPES",
    "AiAuditContext",
    "AiAuditNotFoundError",
    "build_ai_audit_metrics",
    "correlate_ai_audit_request",
    "list_ai_audit_events",
    "record_inspection_audit",
]
