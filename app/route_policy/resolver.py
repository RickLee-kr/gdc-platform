"""Route policy config resolution — dual-read + governance delivery_behavior (M13.5)."""

from __future__ import annotations

from typing import Any

from app.route_policy.config import (
    PersistedSource,
    RoutePolicyConfig,
    RoutePolicyResolution,
    RoutePolicyRuleEntry,
)
from app.route_policy.drift_gates import derive_drift_gates
from app.route_policy.governance_behavior import normalize_delivery_behavior


def _rule_entry_from_row(row: Any, *, source: PersistedSource) -> RoutePolicyRuleEntry:
    return RoutePolicyRuleEntry(
        name=str(getattr(row, "name", "")),
        condition_json=dict(getattr(row, "condition_json", {}) or {}),
        action_type=str(getattr(row, "action_type", "audit_only")),
        enabled=bool(getattr(row, "enabled", True)),
        source=source,  # type: ignore[arg-type]
        id=int(row.id) if getattr(row, "id", None) is not None else None,
    )


def _extract_delivery_behavior(
    route_overrides: list[dict[str, Any]] | None,
    *,
    route_id: int,
) -> str | None:
    """Most restrictive delivery_behavior wins when multiple overrides match."""

    precedence = {"quarantine": 4, "block": 3, "require_review": 2, "continue": 1}
    best: str | None = None
    best_score = 0
    for override in route_overrides or []:
        if int(override.get("route_id", -1)) != int(route_id):
            continue
        if not bool(override.get("enabled", True)):
            continue
        normalized = normalize_delivery_behavior(override.get("delivery_behavior"))
        if normalized is None:
            continue
        score = precedence.get(normalized, 0)
        if score > best_score:
            best = normalized
            best_score = score
    return best


def _count_delivery_behavior_overrides(
    route_overrides: list[dict[str, Any]] | None,
    *,
    route_id: int,
) -> int:
    count = 0
    for override in route_overrides or []:
        if int(override.get("route_id", -1)) != int(route_id):
            continue
        if not bool(override.get("enabled", True)):
            continue
        if normalize_delivery_behavior(override.get("delivery_behavior")) is not None:
            count += 1
    return count


def resolve_route_policy_config(
    *,
    route_id: int,
    stream_id: int,
    route_policy_rules: list[Any] | None = None,
    stream_policy_rules: list[Any] | None = None,
    route_overrides: list[dict[str, Any]] | None = None,
    schema_drift_policy_result: Any | None = None,
) -> RoutePolicyConfig:
    """Dual-read persisted base; drift gates + delivery_behavior resolved at stage."""

    _ = stream_id
    route_rules = [r for r in (route_policy_rules or []) if bool(getattr(r, "enabled", True))]
    stream_rules = [r for r in (stream_policy_rules or []) if bool(getattr(r, "enabled", True))]

    if route_rules:
        persisted = [_rule_entry_from_row(row, source="route") for row in route_rules]
        persisted_source: PersistedSource = "route"
    elif stream_rules:
        persisted = [_rule_entry_from_row(row, source="stream") for row in stream_rules]
        persisted_source = "stream"
    else:
        persisted = []
        persisted_source = "empty"

    override_delivery_behavior = _extract_delivery_behavior(route_overrides, route_id=route_id)
    drift_review, drift_quarantine = derive_drift_gates(
        schema_drift_policy_result,
        route_id=route_id,
        route_overrides=route_overrides,
    )

    return RoutePolicyConfig(
        rules=tuple(persisted),
        override_delivery_behavior=override_delivery_behavior,
        resolution=RoutePolicyResolution(
            persisted_source=persisted_source,
            override_count=_count_delivery_behavior_overrides(route_overrides, route_id=route_id),
            fallback_used=persisted_source == "stream",
            drift_review_required=drift_review,
            drift_quarantine_required=drift_quarantine,
        ),
    )
