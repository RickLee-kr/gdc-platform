"""Typed route policy configuration (M13.5)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

PersistedSource = Literal["route", "stream", "empty"]
RuleSource = Literal["route", "stream"]
PolicyDecision = Literal["allow", "audit", "block", "require_review", "quarantine"]


@dataclass(frozen=True, slots=True)
class RoutePolicyResolution:
    persisted_source: PersistedSource
    override_count: int
    fallback_used: bool
    drift_review_required: bool = False
    drift_quarantine_required: bool = False


@dataclass(frozen=True, slots=True)
class RoutePolicyRuleEntry:
    name: str
    condition_json: dict[str, Any]
    action_type: str
    enabled: bool
    source: RuleSource
    id: int | None = None


@dataclass(slots=True)
class RoutePolicyConfig:
    rules: tuple[RoutePolicyRuleEntry, ...]
    override_delivery_behavior: str | None
    resolution: RoutePolicyResolution

    @property
    def empty(self) -> bool:
        return (
            len(self.rules) == 0
            and self.override_delivery_behavior is None
            and not self.resolution.drift_review_required
            and not self.resolution.drift_quarantine_required
        )

    def rules_as_engine_types(self) -> list[Any]:
        from app.route_policy.engine_adapter import adapt_rules_for_engine

        return adapt_rules_for_engine(self.rules)


@dataclass(frozen=True, slots=True)
class RoutePolicyResult:
    decision: PolicyDecision
    matched_policy_count: int
    persisted_source: PersistedSource
    delivery_blocked: bool
    delivery_allowed: bool
    quarantine_recorded: bool
    review_required: bool
    override_applied: bool
    decision_reason: str
    policy_action: str
    duration_ms: int = 0
    policy_batch_result: Any | None = None
    quarantine_event_id: int | None = None
