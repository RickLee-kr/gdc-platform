"""Governance delivery_behavior normalization (M13.5)."""

from __future__ import annotations

from typing import Any

_DELIVERY_BEHAVIOR_ALIASES = {
    "continue": "continue",
    "continue_delivery": "continue",
    "allow": "continue",
    "block": "block",
    "quarantine": "quarantine",
    "require_review": "require_review",
    "review": "require_review",
}

# Most restrictive wins when combining route overrides + stream defaults.
_DELIVERY_BEHAVIOR_PRECEDENCE = {
    "quarantine": 4,
    "block": 3,
    "require_review": 2,
    "continue": 1,
}


def normalize_delivery_behavior(raw: Any) -> str | None:
    if raw is None:
        return None
    key = str(raw).strip().lower()
    return _DELIVERY_BEHAVIOR_ALIASES.get(key)


def _pick_most_restrictive(candidates: list[str]) -> str | None:
    best: str | None = None
    best_score = 0
    for item in candidates:
        score = _DELIVERY_BEHAVIOR_PRECEDENCE.get(item, 0)
        if score > best_score:
            best = item
            best_score = score
    return best


def extract_route_override_delivery_behavior(
    route_overrides: list[dict[str, Any]] | None,
    *,
    route_id: int,
) -> str | None:
    """Most restrictive enabled route override delivery_behavior for ``route_id``."""

    candidates: list[str] = []
    for override in route_overrides or []:
        if not isinstance(override, dict):
            continue
        if int(override.get("route_id", -1)) != int(route_id):
            continue
        if not bool(override.get("enabled", True)):
            continue
        normalized = normalize_delivery_behavior(override.get("delivery_behavior"))
        if normalized is not None:
            candidates.append(normalized)
    return _pick_most_restrictive(candidates)


def extract_stream_default_delivery_behavior(
    governance_rules: list[dict[str, Any]] | None,
) -> str | None:
    """Most restrictive enabled stream-rule ``default_delivery_behavior``."""

    candidates: list[str] = []
    for rule in governance_rules or []:
        if not isinstance(rule, dict):
            continue
        if not bool(rule.get("enabled", True)):
            continue
        normalized = normalize_delivery_behavior(rule.get("default_delivery_behavior"))
        if normalized is not None:
            candidates.append(normalized)
    return _pick_most_restrictive(candidates)


def resolve_effective_delivery_behavior(
    *,
    route_id: int,
    route_overrides: list[dict[str, Any]] | None = None,
    governance_rules: list[dict[str, Any]] | None = None,
) -> str | None:
    """Route override wins when present; otherwise stream default delivery_behavior."""

    override = extract_route_override_delivery_behavior(route_overrides, route_id=route_id)
    if override is not None:
        return override
    return extract_stream_default_delivery_behavior(governance_rules)


def has_active_delivery_behavior_gates(
    route_overrides: list[dict[str, Any]] | None = None,
    governance_rules: list[dict[str, Any]] | None = None,
) -> bool:
    """True when any enabled override or stream default carries an explicit delivery_behavior."""

    for override in route_overrides or []:
        if not isinstance(override, dict):
            continue
        if not bool(override.get("enabled", True)):
            continue
        if normalize_delivery_behavior(override.get("delivery_behavior")) is not None:
            return True
    for rule in governance_rules or []:
        if not isinstance(rule, dict):
            continue
        if not bool(rule.get("enabled", True)):
            continue
        if normalize_delivery_behavior(rule.get("default_delivery_behavior")) is not None:
            return True
    return False
