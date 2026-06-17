"""Route classification config resolution — dual-read + governance floor (M13.4)."""

from __future__ import annotations

from typing import Any

from app.classification.levels import normalize_level
from app.route_classification.config import (
    PersistedSource,
    RouteClassificationConfig,
    RouteClassificationResolution,
    RouteClassificationRuleEntry,
)


def _rule_entry_from_row(row: Any, *, source: PersistedSource) -> RouteClassificationRuleEntry:
    return RouteClassificationRuleEntry(
        name=str(getattr(row, "name", "")),
        condition_json=dict(getattr(row, "condition_json", {}) or {}),
        classification_level=str(getattr(row, "classification_level", "INTERNAL")),
        enabled=bool(getattr(row, "enabled", True)),
        source=source,  # type: ignore[arg-type]
        id=int(row.id) if getattr(row, "id", None) is not None else None,
    )


def _extract_override_levels(
    route_overrides: list[dict[str, Any]] | None,
    *,
    route_id: int,
) -> tuple[str, ...]:
    levels: list[str] = []
    for override in route_overrides or []:
        if int(override.get("route_id", -1)) != int(route_id):
            continue
        if not bool(override.get("enabled", True)):
            continue
        raw_level = override.get("classification_level")
        if raw_level is None:
            continue
        normalized = normalize_level(str(raw_level))
        if normalized is not None:
            levels.append(normalized)
    return tuple(levels)


def resolve_route_classification_config(
    *,
    route_id: int,
    stream_id: int,
    route_classification_rules: list[Any] | None = None,
    stream_classification_rules: list[Any] | None = None,
    route_overrides: list[dict[str, Any]] | None = None,
) -> RouteClassificationConfig:
    """Dual-read persisted base; governance classification_level floor applied at stage."""

    _ = stream_id
    route_rules = [r for r in (route_classification_rules or []) if bool(getattr(r, "enabled", True))]
    stream_rules = [r for r in (stream_classification_rules or []) if bool(getattr(r, "enabled", True))]

    if route_rules:
        persisted = [_rule_entry_from_row(row, source="route") for row in route_rules]
        persisted_source: PersistedSource = "route"
    elif stream_rules:
        persisted = [_rule_entry_from_row(row, source="stream") for row in stream_rules]
        persisted_source = "stream"
    else:
        persisted = []
        persisted_source = "empty"

    override_levels = _extract_override_levels(route_overrides, route_id=route_id)

    return RouteClassificationConfig(
        rules=tuple(persisted),
        override_levels=override_levels,
        resolution=RouteClassificationResolution(
            persisted_source=persisted_source,
            override_count=len(override_levels),
            fallback_used=persisted_source == "stream",
        ),
    )
