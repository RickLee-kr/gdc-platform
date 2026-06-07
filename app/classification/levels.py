"""Classification level ordering and sensitivity defaults."""

from __future__ import annotations

from app.classification.models import (
    CLASSIFICATION_CONFIDENTIAL,
    CLASSIFICATION_INTERNAL,
    CLASSIFICATION_LEVELS,
    CLASSIFICATION_PUBLIC,
    CLASSIFICATION_RESTRICTED,
)
from app.sensitive_detection.models import (
    SENSITIVITY_CLASS_PII,
    SENSITIVITY_CLASS_SECRET,
    SENSITIVITY_CLASS_SECURITY_METADATA,
)

_LEVEL_RANK: dict[str, int] = {
    CLASSIFICATION_PUBLIC: 0,
    CLASSIFICATION_INTERNAL: 1,
    CLASSIFICATION_CONFIDENTIAL: 2,
    CLASSIFICATION_RESTRICTED: 3,
}

DEFAULT_SENSITIVITY_CLASSIFICATION: dict[str, str] = {
    SENSITIVITY_CLASS_SECRET: CLASSIFICATION_RESTRICTED,
    SENSITIVITY_CLASS_PII: CLASSIFICATION_CONFIDENTIAL,
    SENSITIVITY_CLASS_SECURITY_METADATA: CLASSIFICATION_INTERNAL,
}

_SUPPORTED_RULE_CONDITION_CLASSES = frozenset(
    {
        SENSITIVITY_CLASS_SECRET,
        SENSITIVITY_CLASS_PII,
        SENSITIVITY_CLASS_SECURITY_METADATA,
    }
)


def normalize_level(level: str) -> str | None:
    raw = str(level).strip().upper()
    if raw in CLASSIFICATION_LEVELS:
        return raw
    return None


def max_level(levels: list[str]) -> str:
    if not levels:
        return CLASSIFICATION_INTERNAL
    best = CLASSIFICATION_PUBLIC
    best_rank = -1
    for level in levels:
        normalized = normalize_level(level)
        if normalized is None:
            continue
        rank = _LEVEL_RANK[normalized]
        if rank > best_rank:
            best_rank = rank
            best = normalized
    return best


def default_level_from_findings(finding_classes: set[str]) -> str:
    if not finding_classes:
        return CLASSIFICATION_INTERNAL
    mapped = [
        DEFAULT_SENSITIVITY_CLASSIFICATION[c]
        for c in finding_classes
        if c in DEFAULT_SENSITIVITY_CLASSIFICATION
    ]
    if not mapped:
        return CLASSIFICATION_INTERNAL
    return max_level(mapped)
