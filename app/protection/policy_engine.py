"""M8 policy engine — evaluation only (audit_only; no block/routing)."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.classification.engine import classification_levels_from_events
from app.classification.levels import normalize_level
from app.classification.models import (
    CLASSIFICATION_CONFIDENTIAL,
    CLASSIFICATION_INTERNAL,
    CLASSIFICATION_PUBLIC,
    CLASSIFICATION_RESTRICTED,
)
from app.protection.models import POLICY_ACTION_AUDIT_ONLY, StreamPolicyRule
from app.sensitive_detection.models import (
    SENSITIVITY_CLASS_PII,
    SENSITIVITY_CLASS_SECRET,
    SENSITIVITY_CLASS_SECURITY_METADATA,
)

_SUPPORTED_CONDITION_CLASSES = frozenset(
    {
        SENSITIVITY_CLASS_SECRET,
        SENSITIVITY_CLASS_PII,
        SENSITIVITY_CLASS_SECURITY_METADATA,
    }
)

_SUPPORTED_CLASSIFICATION_CONDITION_LEVELS = frozenset(
    {
        CLASSIFICATION_PUBLIC,
        CLASSIFICATION_INTERNAL,
        CLASSIFICATION_CONFIDENTIAL,
        CLASSIFICATION_RESTRICTED,
    }
)


@dataclass
class PolicyEvaluationItem:
    policy_id: int
    matched: bool
    policy_name: str = ""
    action_type: str = POLICY_ACTION_AUDIT_ONLY


@dataclass
class PolicyBatchResult:
    evaluations: list[PolicyEvaluationItem] = field(default_factory=list)
    matched_policies: list[dict[str, str]] = field(default_factory=list)
    policy_count: int = 0
    matched_policy_count: int = 0
    audit_event_count: int = 0
    duration_ms: int = 0


def _finding_classes(findings: list[dict[str, Any]]) -> set[str]:
    classes: set[str] = set()
    for item in findings:
        if not isinstance(item, dict):
            continue
        raw = item.get("sensitivity_class")
        if raw is not None:
            classes.add(str(raw))
    return classes


def _condition_matches(
    condition_json: Any,
    *,
    finding_classes: set[str],
    classification_levels: set[str],
) -> bool:
    if not isinstance(condition_json, dict):
        return False
    required_level = condition_json.get("classification_level")
    if required_level is not None:
        normalized = normalize_level(str(required_level))
        if normalized is None or normalized not in _SUPPORTED_CLASSIFICATION_CONDITION_LEVELS:
            return False
        return normalized in classification_levels
    required = condition_json.get("sensitivity_class")
    if required is None:
        return False
    required_str = str(required)
    if required_str not in _SUPPORTED_CONDITION_CLASSES:
        return False
    return required_str in finding_classes


def evaluate_event(
    stream_id: int,
    findings: list[dict[str, Any]],
    event: dict[str, Any],
    rules: list[StreamPolicyRule],
) -> list[dict[str, Any]]:
    """Evaluate enabled policies for one event; event is not mutated."""

    _ = stream_id, event
    finding_classes = _finding_classes(findings)
    classification_levels = classification_levels_from_events([event])
    enabled = [r for r in rules if bool(getattr(r, "enabled", True))]
    out: list[dict[str, Any]] = []
    for rule in enabled:
        matched = _condition_matches(
            rule.condition_json,
            finding_classes=finding_classes,
            classification_levels=classification_levels,
        )
        out.append({"policy_id": int(rule.id), "matched": matched})
    return out


def evaluate_batch(
    db: Session | None,
    *,
    stream_id: int,
    events: list[dict[str, Any]],
    findings: list[dict[str, Any]] | None = None,
) -> PolicyBatchResult:
    """Evaluate policies for a delivery batch using sensitive findings (read-only)."""

    started = time.monotonic()
    if db is None or not events:
        return PolicyBatchResult(duration_ms=0)

    rules = list(
        db.execute(
            select(StreamPolicyRule)
            .where(
                StreamPolicyRule.stream_id == int(stream_id),
                StreamPolicyRule.enabled.is_(True),
            )
            .order_by(StreamPolicyRule.id)
        ).scalars()
    )
    if not rules:
        duration_ms = max(0, int((time.monotonic() - started) * 1000))
        return PolicyBatchResult(policy_count=0, duration_ms=duration_ms)

    if findings is None:
        from app.sensitive_detection.detection import detect_hits_for_batch

        findings = detect_hits_for_batch(events)

    finding_classes = _finding_classes(findings)
    classification_levels = classification_levels_from_events(events)
    evaluations: list[PolicyEvaluationItem] = []
    matched_names: list[dict[str, str]] = []
    audit_count = 0

    for rule in rules:
        matched = _condition_matches(
            rule.condition_json,
            finding_classes=finding_classes,
            classification_levels=classification_levels,
        )
        evaluations.append(
            PolicyEvaluationItem(
                policy_id=int(rule.id),
                matched=matched,
                policy_name=str(rule.name),
                action_type=str(rule.action_type),
            )
        )
        if matched:
            matched_names.append({"name": str(rule.name)})
            if str(rule.action_type) == POLICY_ACTION_AUDIT_ONLY:
                audit_count += 1

    duration_ms = max(0, int((time.monotonic() - started) * 1000))
    return PolicyBatchResult(
        evaluations=evaluations,
        matched_policies=matched_names,
        policy_count=len(rules),
        matched_policy_count=len(matched_names),
        audit_event_count=audit_count,
        duration_ms=duration_ms,
    )
