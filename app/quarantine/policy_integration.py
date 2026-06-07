"""Policy batch result helpers for quarantine (no policy engine changes)."""

from __future__ import annotations

from app.protection.models import POLICY_ACTION_QUARANTINE
from app.protection.policy_engine import PolicyBatchResult, PolicyEvaluationItem


def matched_quarantine_evaluations(result: PolicyBatchResult) -> list[PolicyEvaluationItem]:
    return [
        item
        for item in result.evaluations
        if item.matched and str(item.action_type) == POLICY_ACTION_QUARANTINE
    ]


def should_quarantine_batch(result: PolicyBatchResult) -> bool:
    return bool(matched_quarantine_evaluations(result))


def build_quarantine_reason(result: PolicyBatchResult) -> str:
    matched = matched_quarantine_evaluations(result)
    if not matched:
        return "policy:unknown"
    names = [str(item.policy_name) for item in matched if item.policy_name]
    if names:
        return f"policy:{','.join(names)}"
    return f"policy:rule_{matched[0].policy_id}"
