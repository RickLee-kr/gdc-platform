"""Service entrypoints for policy engine (M8)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from app.protection.policy_engine import PolicyBatchResult, evaluate_batch
from app.sensitive_detection.context import SensitiveDetectionContext, findings_from_context
from app.protection.policy_metrics import (
    build_policy_evaluation_complete_payload,
    load_cumulative_policy_totals,
)


def evaluate_policies_for_delivery(
    db: Session | None,
    *,
    stream_id: int,
    enriched_events: list[dict[str, Any]],
    log_fn: Callable[[dict[str, Any]], None] | None = None,
    detection_context: SensitiveDetectionContext | None = None,
    findings: list[dict[str, Any]] | None = None,
) -> PolicyBatchResult:
    """Evaluate policies after protection; does not mutate events or block delivery."""

    shared_findings = findings if findings is not None else findings_from_context(detection_context)
    result = evaluate_batch(
        db,
        stream_id=stream_id,
        events=enriched_events,
        findings=shared_findings,
    )
    if log_fn is not None and enriched_events:
        cumulative = (
            load_cumulative_policy_totals(db, stream_id)
            if db is not None
            else {"total_audit_events": 0, "total_matched_policies": 0}
        )
        payload = build_policy_evaluation_complete_payload(
            stream_id=stream_id,
            result=result,
            cumulative_totals=cumulative,
        )
        if shared_findings is not None:
            payload["sensitive_detection_reused"] = True
            payload["sensitive_detection_passes"] = 1
        log_fn(payload)
    return result


def evaluate_policies_for_preview(
    db: Session | None,
    *,
    stream_id: int,
    enriched_events: list[dict[str, Any]],
    detection_context: SensitiveDetectionContext | None = None,
    findings: list[dict[str, Any]] | None = None,
    policy_result: PolicyBatchResult | None = None,
) -> list[dict[str, str]]:
    """Return matched policy names for preview responses (read-only)."""

    if policy_result is not None:
        return list(policy_result.matched_policies)
    shared_findings = findings if findings is not None else findings_from_context(detection_context)
    result = evaluate_batch(
        db,
        stream_id=stream_id,
        events=enriched_events,
        findings=shared_findings,
    )
    return list(result.matched_policies)


def would_quarantine_for_preview(
    db: Session | None,
    *,
    stream_id: int,
    enriched_events: list[dict[str, Any]],
    detection_context: SensitiveDetectionContext | None = None,
    findings: list[dict[str, Any]] | None = None,
    policy_result: PolicyBatchResult | None = None,
) -> bool:
    """True when a matched enabled policy has action_type=quarantine (no persistence)."""

    from app.quarantine.policy_integration import should_quarantine_batch

    if not enriched_events:
        return False
    if policy_result is not None:
        return should_quarantine_batch(policy_result)
    shared_findings = findings if findings is not None else findings_from_context(detection_context)
    result = evaluate_batch(
        db,
        stream_id=stream_id,
        events=enriched_events,
        findings=shared_findings,
    )
    return should_quarantine_batch(result)
