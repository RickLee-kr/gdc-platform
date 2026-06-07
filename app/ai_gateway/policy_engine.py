"""AI Gateway policy evaluation (separate from stream policy engine)."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai_gateway.models import (
    GATEWAY_ACTION_ALLOW,
    GATEWAY_ACTION_AUDIT,
    GATEWAY_ACTION_BLOCK,
    GATEWAY_ACTION_QUARANTINE,
    GATEWAY_ACTION_TYPES,
    AiGatewayPolicy,
)
from app.classification.levels import normalize_level
from app.classification.models import (
    CLASSIFICATION_CONFIDENTIAL,
    CLASSIFICATION_INTERNAL,
    CLASSIFICATION_PUBLIC,
    CLASSIFICATION_RESTRICTED,
)
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

_SUPPORTED_CLASSIFICATION_LEVELS = frozenset(
    {
        CLASSIFICATION_PUBLIC,
        CLASSIFICATION_INTERNAL,
        CLASSIFICATION_CONFIDENTIAL,
        CLASSIFICATION_RESTRICTED,
    }
)

_ACTION_SEVERITY = {
    GATEWAY_ACTION_ALLOW: 0,
    GATEWAY_ACTION_AUDIT: 1,
    GATEWAY_ACTION_QUARANTINE: 2,
    GATEWAY_ACTION_BLOCK: 3,
}


@dataclass
class GatewayPolicyMatch:
    policy_id: int
    policy_name: str
    action_type: str


@dataclass
class GatewayPolicyBatchResult:
    decision: str = GATEWAY_ACTION_ALLOW
    matched_policies: list[GatewayPolicyMatch] = field(default_factory=list)
    matched_policy_count: int = 0
    policy_count: int = 0
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


def condition_matches(
    condition_json: Any,
    *,
    finding_classes: set[str],
    classification_level: str,
) -> bool:
    if not isinstance(condition_json, dict):
        return False
    required_level = condition_json.get("classification_level")
    if required_level is not None:
        normalized = normalize_level(str(required_level))
        if normalized is None or normalized not in _SUPPORTED_CLASSIFICATION_LEVELS:
            return False
        return normalized == classification_level
    required = condition_json.get("sensitivity_class")
    if required is None:
        return False
    required_str = str(required)
    if required_str not in _SUPPORTED_CONDITION_CLASSES:
        return False
    return required_str in finding_classes


def _resolve_decision(matches: list[GatewayPolicyMatch]) -> str:
    if not matches:
        return GATEWAY_ACTION_ALLOW
    best = GATEWAY_ACTION_ALLOW
    best_score = _ACTION_SEVERITY[GATEWAY_ACTION_ALLOW]
    for item in matches:
        action = str(item.action_type)
        if action not in GATEWAY_ACTION_TYPES:
            continue
        score = _ACTION_SEVERITY[action]
        if score > best_score:
            best_score = score
            best = action
    return best


def evaluate_gateway_policies(
    db: Session | None,
    *,
    classification_level: str,
    findings: list[dict[str, Any]],
) -> GatewayPolicyBatchResult:
    started = time.monotonic()
    if db is None:
        return GatewayPolicyBatchResult(duration_ms=0)

    rules = list(
        db.execute(
            select(AiGatewayPolicy)
            .where(AiGatewayPolicy.enabled.is_(True))
            .order_by(AiGatewayPolicy.id)
        ).scalars()
    )
    if not rules:
        duration_ms = max(0, int((time.monotonic() - started) * 1000))
        return GatewayPolicyBatchResult(duration_ms=duration_ms)

    level = normalize_level(classification_level) or classification_level
    finding_classes = _finding_classes(findings)
    matched: list[GatewayPolicyMatch] = []

    for rule in rules:
        if not condition_matches(
            rule.condition_json,
            finding_classes=finding_classes,
            classification_level=level,
        ):
            continue
        matched.append(
            GatewayPolicyMatch(
                policy_id=int(rule.id),
                policy_name=str(rule.name),
                action_type=str(rule.action_type),
            )
        )

    decision = _resolve_decision(matched)
    duration_ms = max(0, int((time.monotonic() - started) * 1000))
    return GatewayPolicyBatchResult(
        decision=decision,
        matched_policies=matched,
        matched_policy_count=len(matched),
        policy_count=len(rules),
        duration_ms=duration_ms,
    )
