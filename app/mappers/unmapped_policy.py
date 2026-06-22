"""Unmapped source field handling policy for basic JSONPath mapping."""

from __future__ import annotations

from typing import Any

UNMAPPED_FIELDS_POLICY_KEY = "unmapped_fields_policy"
UNMAPPED_POLICY_PASS_THROUGH = "pass_through"
UNMAPPED_POLICY_DROP = "drop_unmapped"
UNMAPPED_FIELD_POLICIES = frozenset({UNMAPPED_POLICY_PASS_THROUGH, UNMAPPED_POLICY_DROP})
DEFAULT_UNMAPPED_FIELDS_POLICY = UNMAPPED_POLICY_PASS_THROUGH


def get_unmapped_fields_policy(field_mappings: dict[str, Any] | None) -> str:
    """Return normalized unmapped-fields policy from field_mappings meta."""

    if not isinstance(field_mappings, dict):
        return DEFAULT_UNMAPPED_FIELDS_POLICY
    raw = field_mappings.get(UNMAPPED_FIELDS_POLICY_KEY, DEFAULT_UNMAPPED_FIELDS_POLICY)
    value = str(raw).strip() if raw is not None else ""
    if value in UNMAPPED_FIELD_POLICIES:
        return value
    return DEFAULT_UNMAPPED_FIELDS_POLICY


def should_pass_through_unmapped(field_mappings: dict[str, Any] | None) -> bool:
    return get_unmapped_fields_policy(field_mappings) == UNMAPPED_POLICY_PASS_THROUGH
