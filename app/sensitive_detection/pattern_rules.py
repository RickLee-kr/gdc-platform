"""Value pattern rules for sensitive detection (PEM + email only)."""

from __future__ import annotations

import re

from app.sensitive_detection.models import (
    DETECTION_METHOD_PATTERN,
    SENSITIVITY_CLASS_PII,
    SENSITIVITY_CLASS_SECRET,
)
from app.sensitive_detection.path_rules import apply_false_positive_policy, leaf_allows_pattern_pii, leaf_segment

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_MAX_EMAIL_LEN = 320


def pem_pattern_match(value: str) -> bool:
    return "-----BEGIN" in value and "-----END" in value


def email_pattern_match(value: str) -> bool:
    if len(value) > _MAX_EMAIL_LEN:
        return False
    return _EMAIL_RE.match(value) is not None


def evaluate_pattern_rules(
    field_path: str,
    *,
    inferred_type: str,
    sample_value: str | None,
) -> dict[str, str] | None:
    """At most one pattern hit per path per run (PEM before email)."""

    if inferred_type != "string" or not sample_value:
        return None
    leaf = leaf_segment(field_path)

    if pem_pattern_match(sample_value):
        if apply_false_positive_policy(leaf, sensitivity_class=SENSITIVITY_CLASS_SECRET, tier="tier_b"):
            return {
                "sensitivity_class": SENSITIVITY_CLASS_SECRET,
                "detection_method": DETECTION_METHOD_PATTERN,
                "matched_rule": "pattern.pem",
                "matched_segment": leaf or "value",
                "pattern": "pem",
            }

    if email_pattern_match(sample_value):
        if not leaf_allows_pattern_pii(leaf):
            return None
        if apply_false_positive_policy(leaf, sensitivity_class=SENSITIVITY_CLASS_PII, tier="tier_b"):
            return {
                "sensitivity_class": SENSITIVITY_CLASS_PII,
                "detection_method": DETECTION_METHOD_PATTERN,
                "matched_rule": "pattern.email",
                "matched_segment": leaf or "value",
                "pattern": "email",
            }

    return None
