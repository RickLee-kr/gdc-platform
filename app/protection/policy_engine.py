"""M8 policy engine — stream policy evaluation; M22 AI policy extensions."""

from __future__ import annotations

import re
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


_EMBEDDED_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def _findings_from_text(text: str) -> list[dict[str, Any]]:
    from app.sensitive_detection.detection import detect_hits_for_batch

    event = {"prompt_text": text, "response_text": text}
    findings = detect_hits_for_batch([event])
    if _EMBEDDED_EMAIL_RE.search(text):
        findings.append(
            {
                "field_path": "$.prompt_text",
                "inferred_type": "string",
                "sensitivity_class": SENSITIVITY_CLASS_PII,
                "detection_method": "pattern",
                "matched_rule": "pattern.email",
            }
        )
    return findings


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


def evaluate_injected_policy_batch(
    *,
    rules: list[Any],
    events: list[dict[str, Any]],
    findings: list[dict[str, Any]] | None = None,
) -> PolicyBatchResult:
    """Evaluate injected policy rules without stream-scoped DB lookup (M13.5 route path)."""

    started = time.monotonic()
    if not events:
        return PolicyBatchResult(duration_ms=0)

    enabled = [r for r in rules if bool(getattr(r, "enabled", True))]
    if not enabled:
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

    for rule in enabled:
        rule_id = getattr(rule, "id", None)
        matched = _condition_matches(
            rule.condition_json,
            finding_classes=finding_classes,
            classification_levels=classification_levels,
        )
        evaluations.append(
            PolicyEvaluationItem(
                policy_id=int(rule_id) if rule_id is not None else 0,
                matched=matched,
                policy_name=str(getattr(rule, "name", "")),
                action_type=str(getattr(rule, "action_type", POLICY_ACTION_AUDIT_ONLY)),
            )
        )
        if matched:
            matched_names.append({"name": str(getattr(rule, "name", ""))})
            if str(getattr(rule, "action_type", "")) == POLICY_ACTION_AUDIT_ONLY:
                audit_count += 1

    duration_ms = max(0, int((time.monotonic() - started) * 1000))
    return PolicyBatchResult(
        evaluations=evaluations,
        matched_policies=matched_names,
        policy_count=len(enabled),
        matched_policy_count=len(matched_names),
        audit_event_count=audit_count,
        duration_ms=duration_ms,
    )


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

    result = evaluate_injected_policy_batch(rules=rules, events=events, findings=findings)
    duration_ms = max(0, int((time.monotonic() - started) * 1000))
    return PolicyBatchResult(
        evaluations=result.evaluations,
        matched_policies=result.matched_policies,
        policy_count=result.policy_count,
        matched_policy_count=result.matched_policy_count,
        audit_event_count=result.audit_event_count,
        duration_ms=duration_ms,
    )


# --- M22 AI policy evaluation (same engine module; enforcement elsewhere) ---

from app.ai_policy.models import (  # noqa: E402
    AI_POLICY_ACTION_ALLOW,
    AI_POLICY_ACTION_BLOCK,
    AI_POLICY_ACTION_DENY,
    AI_POLICY_ACTION_MASK,
    AI_POLICY_ACTION_REDACT,
    AI_POLICY_INSPECTION_KEYWORD,
    AI_POLICY_INSPECTION_PII,
    AI_POLICY_INSPECTION_REGEX,
    AI_POLICY_INSPECTION_SECRET_PATTERN,
    AI_POLICY_INSPECTION_SENSITIVE_CONTENT,
    AI_POLICY_TARGET_PROMPT,
    AI_POLICY_TARGET_RESPONSE,
    AiPolicyRule,
)

_AI_POLICY_ACTION_SEVERITY = {
    AI_POLICY_ACTION_ALLOW: 0,
    AI_POLICY_ACTION_MASK: 1,
    AI_POLICY_ACTION_REDACT: 2,
    AI_POLICY_ACTION_DENY: 3,
    AI_POLICY_ACTION_BLOCK: 4,
}


@dataclass
class AiPolicyMatch:
    policy_id: int
    policy_name: str
    action_type: str
    inspection_type: str = ""


@dataclass
class AiPolicyBatchResult:
    decision: str = AI_POLICY_ACTION_ALLOW
    matched_policies: list[AiPolicyMatch] = field(default_factory=list)
    matched_policy_count: int = 0
    policy_count: int = 0
    duration_ms: int = 0
    findings: list[dict[str, Any]] = field(default_factory=list)


def _ai_regex_matches(condition_json: dict[str, Any], text: str) -> bool:
    pattern = str(condition_json.get("pattern") or "")
    if not pattern:
        return False
    flags = 0
    if bool(condition_json.get("ignore_case", True)):
        flags |= re.IGNORECASE
    try:
        return re.search(pattern, text, flags) is not None
    except re.error:
        return False


def _ai_keyword_matches(condition_json: dict[str, Any], text: str) -> bool:
    keyword = str(condition_json.get("keyword") or "")
    if not keyword:
        return False
    if bool(condition_json.get("ignore_case", True)):
        return keyword.lower() in text.lower()
    return keyword in text


def _ai_rule_matches(
    rule: AiPolicyRule,
    *,
    text: str,
    finding_classes: set[str],
) -> bool:
    inspection = str(rule.inspection_type)
    condition = dict(rule.condition_json) if isinstance(rule.condition_json, dict) else {}
    if inspection == AI_POLICY_INSPECTION_REGEX:
        return _ai_regex_matches(condition, text)
    if inspection == AI_POLICY_INSPECTION_KEYWORD:
        return _ai_keyword_matches(condition, text)
    if inspection == AI_POLICY_INSPECTION_PII:
        return SENSITIVITY_CLASS_PII in finding_classes
    if inspection == AI_POLICY_INSPECTION_SECRET_PATTERN:
        return SENSITIVITY_CLASS_SECRET in finding_classes
    if inspection == AI_POLICY_INSPECTION_SENSITIVE_CONTENT:
        return bool(
            finding_classes
            & {
                SENSITIVITY_CLASS_PII,
                SENSITIVITY_CLASS_SECRET,
                SENSITIVITY_CLASS_SECURITY_METADATA,
            }
        )
    return False


def _resolve_ai_policy_decision(matches: list[AiPolicyMatch]) -> str:
    if not matches:
        return AI_POLICY_ACTION_ALLOW
    best = AI_POLICY_ACTION_ALLOW
    best_score = _AI_POLICY_ACTION_SEVERITY[best]
    for item in matches:
        action = str(item.action_type)
        score = _AI_POLICY_ACTION_SEVERITY.get(action, 0)
        if score >= best_score:
            best = action
            best_score = score
    return best


def evaluate_ai_policy_rules(
    db: Session | None,
    *,
    ai_stream_id: int,
    target: str,
    text: str,
    findings: list[dict[str, Any]] | None = None,
) -> AiPolicyBatchResult:
    """Evaluate enabled AI policy rules for prompt or response inspection."""

    started = time.monotonic()
    if db is None or not text.strip():
        duration_ms = max(0, int((time.monotonic() - started) * 1000))
        return AiPolicyBatchResult(duration_ms=duration_ms)

    rules = list(
        db.execute(
            select(AiPolicyRule)
            .where(
                AiPolicyRule.ai_stream_id == int(ai_stream_id),
                AiPolicyRule.enabled.is_(True),
                AiPolicyRule.target == str(target),
            )
            .order_by(AiPolicyRule.id)
        ).scalars()
    )
    if not rules:
        duration_ms = max(0, int((time.monotonic() - started) * 1000))
        return AiPolicyBatchResult(duration_ms=duration_ms)

    shared_findings = list(findings or [])
    if not shared_findings and text.strip():
        shared_findings = _findings_from_text(text)

    finding_classes = _finding_classes(shared_findings)
    matched: list[AiPolicyMatch] = []
    for rule in rules:
        if not _ai_rule_matches(rule, text=text, finding_classes=finding_classes):
            continue
        matched.append(
            AiPolicyMatch(
                policy_id=int(rule.id),
                policy_name=str(rule.name),
                action_type=str(rule.action_type),
                inspection_type=str(rule.inspection_type),
            )
        )

    decision = _resolve_ai_policy_decision(matched)
    duration_ms = max(0, int((time.monotonic() - started) * 1000))
    return AiPolicyBatchResult(
        decision=decision,
        matched_policies=matched,
        matched_policy_count=len(matched),
        policy_count=len(rules),
        duration_ms=duration_ms,
        findings=shared_findings,
    )


def evaluate_ai_prompt_policy(
    db: Session | None,
    *,
    ai_stream_id: int,
    text: str,
    findings: list[dict[str, Any]] | None = None,
) -> AiPolicyBatchResult:
    return evaluate_ai_policy_rules(
        db,
        ai_stream_id=ai_stream_id,
        target=AI_POLICY_TARGET_PROMPT,
        text=text,
        findings=findings,
    )


def evaluate_ai_response_policy(
    db: Session | None,
    *,
    ai_stream_id: int,
    text: str,
    findings: list[dict[str, Any]] | None = None,
) -> AiPolicyBatchResult:
    return evaluate_ai_policy_rules(
        db,
        ai_stream_id=ai_stream_id,
        target=AI_POLICY_TARGET_RESPONSE,
        text=text,
        findings=findings,
    )
