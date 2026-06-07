"""M13 classification engine — rule-based level resolution."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.classification.field_keys import stamp_classification_level
from app.classification.levels import (
    _SUPPORTED_RULE_CONDITION_CLASSES,
    default_level_from_findings,
    max_level,
    normalize_level,
)
from app.classification.models import StreamClassificationRule
from app.config import settings

@dataclass
class ClassificationBatchResult:
    classification_level: str = "INTERNAL"
    matched_rule_count: int = 0
    events_classified: int = 0
    duration_ms: int = 0
    findings: list[dict[str, Any]] = field(default_factory=list)


def classification_enabled() -> bool:
    return bool(settings.GDC_CLASSIFICATION_ENABLED)


def _finding_classes(findings: list[dict[str, Any]]) -> set[str]:
    classes: set[str] = set()
    for item in findings:
        if not isinstance(item, dict):
            continue
        raw = item.get("sensitivity_class")
        if raw is not None:
            classes.add(str(raw))
    return classes


def rule_condition_matches(condition_json: Any, *, finding_classes: set[str]) -> bool:
    if not isinstance(condition_json, dict):
        return False
    required = condition_json.get("sensitivity_class")
    if required is None:
        return False
    required_str = str(required)
    if required_str not in _SUPPORTED_RULE_CONDITION_CLASSES:
        return False
    return required_str in finding_classes


def resolve_classification_level(
    *,
    finding_classes: set[str],
    rules: list[StreamClassificationRule],
) -> tuple[str, int]:
    """Explicit rules override default sensitivity mapping when any rule matches."""

    enabled = [r for r in rules if bool(getattr(r, "enabled", True))]
    matched_levels: list[str] = []
    for rule in enabled:
        if not rule_condition_matches(rule.condition_json, finding_classes=finding_classes):
            continue
        level = normalize_level(str(rule.classification_level))
        if level is not None:
            matched_levels.append(level)
    if matched_levels:
        return max_level(matched_levels), len(matched_levels)
    return default_level_from_findings(finding_classes), 0


def classify_batch(
    events: list[dict[str, Any]],
    *,
    stream_id: int,
    rules: list[StreamClassificationRule],
    findings: list[dict[str, Any]] | None = None,
) -> ClassificationBatchResult:
    """Stamp classification on event dicts in place; returns batch metadata."""

    started = time.monotonic()
    if not events:
        return ClassificationBatchResult(duration_ms=0)

    if findings is None:
        from app.sensitive_detection.detection import detect_hits_for_batch

        findings = detect_hits_for_batch(events)

    finding_classes = _finding_classes(findings)
    level, matched_rule_count = resolve_classification_level(
        finding_classes=finding_classes,
        rules=rules,
    )

    classified = 0
    for raw in events:
        if not isinstance(raw, dict):
            continue
        stamp_classification_level(raw, level)
        classified += 1

    duration_ms = max(0, int((time.monotonic() - started) * 1000))
    return ClassificationBatchResult(
        classification_level=level,
        matched_rule_count=matched_rule_count,
        events_classified=classified,
        duration_ms=duration_ms,
        findings=findings,
    )


def evaluate_batch(
    db: Session | None,
    *,
    stream_id: int,
    events: list[dict[str, Any]],
    findings: list[dict[str, Any]] | None = None,
) -> ClassificationBatchResult:
    if db is None or not events or not classification_enabled():
        return ClassificationBatchResult(duration_ms=0)

    rules = list(
        db.execute(
            select(StreamClassificationRule)
            .where(
                StreamClassificationRule.stream_id == int(stream_id),
                StreamClassificationRule.enabled.is_(True),
            )
            .order_by(StreamClassificationRule.id)
        ).scalars()
    )
    return classify_batch(
        events,
        stream_id=stream_id,
        rules=rules,
        findings=findings,
    )


def classification_levels_from_events(events: list[dict[str, Any]]) -> set[str]:
    from app.classification.field_keys import read_classification_level

    levels: set[str] = set()
    for ev in events:
        if not isinstance(ev, dict):
            continue
        raw = read_classification_level(ev)
        if raw is not None:
            normalized = normalize_level(raw)
            if normalized is not None:
                levels.add(normalized)
    return levels
