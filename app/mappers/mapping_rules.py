"""Normalize stored field_mappings_json into mapping rule records (JSONPath MVP)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

_TRANSFORM_RULES_KEY = "transform_rules"


@dataclass(frozen=True)
class MappingRule:
    output_field: str
    source_json_path: str
    transforms: tuple[str, ...] = ()


def parse_mapping_rule(output_field: str, raw_value: Any) -> MappingRule | None:
    """Parse one field_mappings entry; plain strings are JSONPath sources."""

    if isinstance(raw_value, str):
        path = raw_value.strip()
        if not path:
            return None
        return MappingRule(output_field=output_field, source_json_path=path, transforms=())

    if isinstance(raw_value, dict):
        path = str(
            raw_value.get("source_json_path")
            or raw_value.get("json_path")
            or raw_value.get("path")
            or ""
        ).strip()
        if not path:
            return None
        transforms_raw = raw_value.get("transforms") or []
        transforms = (
            tuple(str(t) for t in transforms_raw)
            if isinstance(transforms_raw, list)
            else ()
        )
        return MappingRule(output_field=output_field, source_json_path=path, transforms=transforms)

    return None


def normalize_field_mappings(field_mappings: dict[str, Any] | None) -> list[MappingRule]:
    """Expand field_mappings_json into normalized rule rows (skips meta keys)."""

    rules: list[MappingRule] = []
    for key, raw_value in dict(field_mappings or {}).items():
        if key == _TRANSFORM_RULES_KEY or key.startswith("_"):
            continue
        rule = parse_mapping_rule(str(key), raw_value)
        if rule is not None:
            rules.append(rule)
    return rules


__all__ = ["MappingRule", "normalize_field_mappings", "parse_mapping_rule"]
