"""Adapter from route policy config entries to engine input (M13.5)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.route_policy.config import RoutePolicyRuleEntry


@dataclass(frozen=True, slots=True)
class EnginePolicyRule:
    """Duck-type compatible with StreamPolicyRule for policy evaluation."""

    enabled: bool
    condition_json: dict[str, Any]
    action_type: str
    name: str = ""
    id: int | None = None


def adapt_rules_for_engine(rules: tuple[RoutePolicyRuleEntry, ...]) -> list[EnginePolicyRule]:
    return [
        EnginePolicyRule(
            enabled=rule.enabled,
            condition_json=dict(rule.condition_json),
            action_type=rule.action_type,
            name=rule.name,
            id=rule.id,
        )
        for rule in rules
    ]
