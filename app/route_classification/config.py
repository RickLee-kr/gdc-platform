"""Typed route classification configuration (M13.4)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

PersistedSource = Literal["route", "stream", "empty"]
RuleSource = Literal["route", "stream"]


@dataclass(frozen=True, slots=True)
class RouteClassificationResolution:
    persisted_source: PersistedSource
    override_count: int
    fallback_used: bool


@dataclass(frozen=True, slots=True)
class RouteClassificationRuleEntry:
    name: str
    condition_json: dict[str, Any]
    classification_level: str
    enabled: bool
    source: RuleSource
    id: int | None = None


@dataclass(slots=True)
class RouteClassificationConfig:
    rules: tuple[RouteClassificationRuleEntry, ...]
    override_levels: tuple[str, ...]
    resolution: RouteClassificationResolution

    @property
    def empty(self) -> bool:
        return len(self.rules) == 0 and len(self.override_levels) == 0

    def rules_as_engine_types(self) -> list[Any]:
        """Adapter — map entries to engine-compatible rule objects."""

        from app.route_classification.engine_adapter import adapt_rules_for_engine

        return adapt_rules_for_engine(self.rules)


@dataclass(frozen=True, slots=True)
class RouteClassificationResult:
    effective_level: str
    matched_rule_count: int
    persisted_source: PersistedSource
    override_applied: bool
    duration_ms: int = 0
