"""AI governance violations, workflow, and dashboard aggregation (M24)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai_audit.service import build_ai_audit_metrics
from app.ai_governance.models import (
    SEVERITY_HIGH,
    SEVERITY_MEDIUM,
    VIOLATION_STATUS_ACKNOWLEDGED,
    VIOLATION_STATUS_OPEN,
    VIOLATION_STATUS_RESOLVED,
    AiPolicyViolation,
)
from app.ai_policy.inspection import AiInspectionResult
from app.ai_policy.models import (
    AI_POLICY_ACTION_BLOCK,
    AI_POLICY_ACTION_DENY,
    AI_POLICY_ACTION_MASK,
    AI_POLICY_ACTION_REDACT,
    AI_POLICY_BLOCKING_ACTIONS,
)
from app.ai_providers.traffic_metrics import build_ai_traffic_summary
from app.ai_streams.models import AiStream

ViolationStatusFilter = Literal["open", "acknowledged", "resolved", "all"]

_ENFORCEMENT_ACTIONS = frozenset(
    {
        AI_POLICY_ACTION_BLOCK,
        AI_POLICY_ACTION_DENY,
        AI_POLICY_ACTION_MASK,
        AI_POLICY_ACTION_REDACT,
    }
)


class AiPolicyViolationNotFoundError(Exception):
    def __init__(self, violation_id: int) -> None:
        self.violation_id = violation_id
        super().__init__(f"ai policy violation not found: {violation_id}")


class AiPolicyViolationStateError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)


def normalize_status_filter(raw: str | None) -> ViolationStatusFilter:
    if raw is None or raw.strip() == "":
        return "open"
    value = raw.strip().lower()
    if value in ("open", "acknowledged", "resolved", "all"):
        return value  # type: ignore[return-value]
    raise ValueError(f"invalid status filter: {raw!r}; expected open, acknowledged, resolved, or all")


def _severity_for_action(action: str) -> str:
    act = str(action).strip().lower()
    if act in AI_POLICY_BLOCKING_ACTIONS:
        return SEVERITY_HIGH
    if act in {AI_POLICY_ACTION_MASK, AI_POLICY_ACTION_REDACT}:
        return SEVERITY_MEDIUM
    return SEVERITY_MEDIUM


def _resolve_ai_stream_label(db: Session, ai_stream_id: int | None) -> str | None:
    if ai_stream_id is None:
        return None
    row = db.get(AiStream, int(ai_stream_id))
    if row is None:
        return None
    return str(row.slug) if row.slug else f"ai-stream-{row.id}"


def _serialize_violation(row: AiPolicyViolation) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "request_id": str(row.request_id),
        "stream_id": row.stream_id,
        "ai_provider_id": row.ai_provider_id,
        "ai_stream_id": row.ai_stream_id,
        "policy_rule_id": row.policy_rule_id,
        "provider": row.provider,
        "ai_stream": row.ai_stream,
        "rule_id": row.rule_id,
        "action": str(row.action),
        "severity": str(row.severity),
        "status": str(row.status),
        "operator_note": row.operator_note,
        "acknowledged_at": row.acknowledged_at,
        "acknowledged_by": row.acknowledged_by,
        "resolved_at": row.resolved_at,
        "resolved_by": row.resolved_by,
        "created_at": row.created_at,
    }


def record_policy_violation(
    db: Session | None,
    inspection: AiInspectionResult,
    *,
    request_id: str,
    stream_id: int | None = None,
    ai_stream_id: int | None = None,
    ai_provider_id: int | None = None,
    provider: str | None = None,
) -> AiPolicyViolation | None:
    """Persist a governance violation when enforcement action is applied."""

    if db is None or not request_id:
        return None
    action = str(inspection.policy.decision).strip().lower()
    if action not in _ENFORCEMENT_ACTIONS:
        return None

    rule_id: str | None = None
    policy_rule_id: int | None = None
    if inspection.policy.matched_policies:
        top = inspection.policy.matched_policies[-1]
        policy_rule_id = int(top.policy_id)
        rule_id = str(top.policy_name) if top.policy_name else str(top.policy_id)

    row = AiPolicyViolation(
        request_id=str(request_id),
        stream_id=stream_id,
        ai_provider_id=ai_provider_id,
        ai_stream_id=ai_stream_id,
        policy_rule_id=policy_rule_id,
        provider=provider,
        ai_stream=_resolve_ai_stream_label(db, ai_stream_id),
        rule_id=rule_id,
        action=action,
        severity=_severity_for_action(action),
        status=VIOLATION_STATUS_OPEN,
    )
    db.add(row)
    db.flush()
    return row


def list_ai_policy_violations(
    db: Session,
    *,
    status_filter: ViolationStatusFilter = "open",
    provider: str | None = None,
    ai_stream_id: int | None = None,
    policy_rule_id: int | None = None,
    request_id: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    limit: int = 100,
) -> list[AiPolicyViolation]:
    stmt = select(AiPolicyViolation).order_by(
        AiPolicyViolation.created_at.desc(),
        AiPolicyViolation.id.desc(),
    )
    if status_filter != "all":
        status_map = {
            "open": VIOLATION_STATUS_OPEN,
            "acknowledged": VIOLATION_STATUS_ACKNOWLEDGED,
            "resolved": VIOLATION_STATUS_RESOLVED,
        }
        stmt = stmt.where(AiPolicyViolation.status == status_map[status_filter])
    if provider is not None:
        stmt = stmt.where(AiPolicyViolation.provider == str(provider).strip())
    if ai_stream_id is not None:
        stmt = stmt.where(AiPolicyViolation.ai_stream_id == int(ai_stream_id))
    if policy_rule_id is not None:
        stmt = stmt.where(AiPolicyViolation.policy_rule_id == int(policy_rule_id))
    if request_id is not None:
        stmt = stmt.where(AiPolicyViolation.request_id == str(request_id).strip())
    if created_from is not None:
        stmt = stmt.where(AiPolicyViolation.created_at >= created_from)
    if created_to is not None:
        stmt = stmt.where(AiPolicyViolation.created_at <= created_to)
    stmt = stmt.limit(max(1, min(int(limit), 500)))
    return list(db.execute(stmt).scalars())


def get_ai_policy_violation(db: Session, violation_id: int) -> AiPolicyViolation:
    row = db.get(AiPolicyViolation, int(violation_id))
    if row is None:
        raise AiPolicyViolationNotFoundError(int(violation_id))
    return row


def acknowledge_ai_policy_violation(
    db: Session,
    *,
    violation_id: int,
    actor_username: str,
    note: str | None = None,
) -> AiPolicyViolation:
    row = get_ai_policy_violation(db, violation_id)
    if row.status != VIOLATION_STATUS_OPEN:
        raise AiPolicyViolationStateError(
            f"violation {violation_id} cannot be acknowledged from status {row.status!r}"
        )
    now = datetime.now(timezone.utc)
    row.status = VIOLATION_STATUS_ACKNOWLEDGED
    row.acknowledged_at = now
    row.acknowledged_by = actor_username
    if note is not None and note.strip():
        row.operator_note = note.strip()
    return row


def resolve_ai_policy_violation(
    db: Session,
    *,
    violation_id: int,
    actor_username: str,
    note: str | None = None,
) -> AiPolicyViolation:
    row = get_ai_policy_violation(db, violation_id)
    if row.status not in {VIOLATION_STATUS_OPEN, VIOLATION_STATUS_ACKNOWLEDGED}:
        raise AiPolicyViolationStateError(
            f"violation {violation_id} cannot be resolved from status {row.status!r}"
        )
    now = datetime.now(timezone.utc)
    row.status = VIOLATION_STATUS_RESOLVED
    row.resolved_at = now
    row.resolved_by = actor_username
    if note is not None and note.strip():
        row.operator_note = note.strip()
    return row


def _window_start(hours: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(hours=max(1, min(int(hours), 168)))


def _action_bucket(action: str) -> str:
    act = str(action).strip().lower()
    if act in AI_POLICY_BLOCKING_ACTIONS:
        return "block"
    if act == AI_POLICY_ACTION_MASK:
        return "mask"
    if act == AI_POLICY_ACTION_REDACT:
        return "redact"
    return "other"


def build_policy_impact_analysis(
    db: Session,
    *,
    hours: int = 24,
    stream_id: int | None = None,
    provider_id: int | None = None,
) -> list[dict[str, Any]]:
    since = _window_start(hours)
    stmt = select(AiPolicyViolation).where(AiPolicyViolation.created_at >= since)
    if stream_id is not None:
        stmt = stmt.where(AiPolicyViolation.stream_id == int(stream_id))
    if provider_id is not None:
        stmt = stmt.where(AiPolicyViolation.ai_provider_id == int(provider_id))
    rows = list(db.execute(stmt).scalars())

    by_policy: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = str(row.policy_rule_id) if row.policy_rule_id is not None else (row.rule_id or "unknown")
        bucket = by_policy.setdefault(
            key,
            {
                "policy_rule_id": row.policy_rule_id,
                "rule_id": row.rule_id,
                "block_count": 0,
                "mask_count": 0,
                "redact_count": 0,
                "total_count": 0,
            },
        )
        kind = _action_bucket(str(row.action))
        if kind == "block":
            bucket["block_count"] += 1
        elif kind == "mask":
            bucket["mask_count"] += 1
        elif kind == "redact":
            bucket["redact_count"] += 1
        bucket["total_count"] += 1

    return sorted(by_policy.values(), key=lambda item: int(item["total_count"]), reverse=True)


def build_ai_governance_dashboard(
    db: Session,
    *,
    hours: int = 24,
    stream_id: int | None = None,
    provider_id: int | None = None,
) -> dict[str, Any]:
    since = _window_start(hours)
    traffic = build_ai_traffic_summary(db, hours=hours, stream_id=stream_id)
    audit_metrics = build_ai_audit_metrics(db, hours=hours, stream_id=stream_id, provider_id=provider_id)

    violation_stmt = select(AiPolicyViolation).where(AiPolicyViolation.created_at >= since)
    if stream_id is not None:
        violation_stmt = violation_stmt.where(AiPolicyViolation.stream_id == int(stream_id))
    if provider_id is not None:
        violation_stmt = violation_stmt.where(AiPolicyViolation.ai_provider_id == int(provider_id))
    violations = list(db.execute(violation_stmt).scalars())

    open_count = sum(1 for v in violations if v.status == VIOLATION_STATUS_OPEN)
    ack_count = sum(1 for v in violations if v.status == VIOLATION_STATUS_ACKNOWLEDGED)
    resolved_count = sum(1 for v in violations if v.status == VIOLATION_STATUS_RESOLVED)

    policy_counts: dict[str, tuple[str, int]] = {}
    provider_counts: dict[str, tuple[str, int]] = {}
    stream_counts: dict[str, tuple[str, int]] = {}

    for row in violations:
        policy_key = str(row.policy_rule_id) if row.policy_rule_id is not None else (row.rule_id or "unknown")
        policy_label = row.rule_id or policy_key
        prev = policy_counts.get(policy_key, (policy_label, 0))
        policy_counts[policy_key] = (policy_label, prev[1] + 1)

        prov_key = row.provider or (str(row.ai_provider_id) if row.ai_provider_id else "unknown")
        prov_label = row.provider or prov_key
        prev = provider_counts.get(prov_key, (prov_label, 0))
        provider_counts[prov_key] = (prov_label, prev[1] + 1)

        stream_key = str(row.ai_stream_id) if row.ai_stream_id is not None else (row.ai_stream or "unknown")
        stream_label = row.ai_stream or stream_key
        prev = stream_counts.get(stream_key, (stream_label, 0))
        stream_counts[stream_key] = (stream_label, prev[1] + 1)

    def _ranked(items: dict[str, tuple[str, int]], *, limit: int = 10) -> list[dict[str, Any]]:
        sorted_items = sorted(items.items(), key=lambda kv: kv[1][1], reverse=True)[:limit]
        return [{"key": key, "label": label, "count": count} for key, (label, count) in sorted_items]

    totals = audit_metrics.get("totals") or {}
    return {
        "window_hours": int(hours),
        "total_requests": int(traffic.get("requests") or 0),
        "policy_blocks": int(totals.get("blocked_count") or 0),
        "policy_violations": len(violations),
        "mask_events": int(totals.get("masked_count") or 0),
        "redact_events": int(totals.get("redacted_count") or 0),
        "open_violations": open_count,
        "acknowledged_violations": ack_count,
        "resolved_violations": resolved_count,
        "top_violated_policies": _ranked(policy_counts),
        "top_providers": _ranked(provider_counts),
        "top_ai_streams": _ranked(stream_counts),
        "policy_impact": build_policy_impact_analysis(
            db,
            hours=hours,
            stream_id=stream_id,
            provider_id=provider_id,
        ),
    }


def count_violations_by_status(db: Session, *, since: datetime | None = None) -> dict[str, int]:
    stmt = select(AiPolicyViolation.status, func.count(AiPolicyViolation.id)).group_by(AiPolicyViolation.status)
    if since is not None:
        stmt = stmt.where(AiPolicyViolation.created_at >= since)
    rows = db.execute(stmt).all()
    out = {VIOLATION_STATUS_OPEN: 0, VIOLATION_STATUS_ACKNOWLEDGED: 0, VIOLATION_STATUS_RESOLVED: 0}
    for status, count in rows:
        out[str(status)] = int(count)
    return out


__all__ = [
    "AiPolicyViolationNotFoundError",
    "AiPolicyViolationStateError",
    "acknowledge_ai_policy_violation",
    "build_ai_governance_dashboard",
    "build_policy_impact_analysis",
    "get_ai_policy_violation",
    "list_ai_policy_violations",
    "normalize_status_filter",
    "record_policy_violation",
    "resolve_ai_policy_violation",
]
