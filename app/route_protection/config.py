"""Typed route protection configuration (M13.3)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

ProtectionSource = Literal["route", "stream", "route_override", "ephemeral", "empty"]
PersistedSource = Literal["route", "stream", "empty"]


@dataclass(frozen=True, slots=True)
class RouteProtectionResolution:
    persisted_source: PersistedSource
    override_count: int
    ephemeral_rule_count: int
    fallback_used: bool


@dataclass(frozen=True, slots=True)
class RouteProtectionRuleEntry:
    """Effective rule passed to protect_batch()."""

    stream_id: int
    field_path: str
    protection_mode: str
    sensitivity_class: str
    enabled: bool
    source: ProtectionSource
    id: int | None = None
    source_finding_id: int | None = None


@dataclass(slots=True)
class RouteProtectionConfig:
    rules: tuple[RouteProtectionRuleEntry, ...]
    audit_only_paths: tuple[str, ...]
    resolution: RouteProtectionResolution
    override_rules_by_path: dict[str, RouteProtectionRuleEntry] = field(default_factory=dict)

    @property
    def empty(self) -> bool:
        return len(self.rules) == 0 and len(self.audit_only_paths) == 0
