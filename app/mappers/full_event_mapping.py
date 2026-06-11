"""Full-event mapping modes (JSONata / regex config) for preview and runtime."""

from __future__ import annotations

import json
import re
from typing import Any

from app.parsers.jsonpath_parser import extract_one
from app.runtime.copy_utils import copy_json_value
from app.runtime.errors import MappingError

FIELD_MAPPINGS_META_KEYS = frozenset(
    {
        "transform_rules",
        "advanced_fields",
        "mapping_mode",
        "jsonata_expression",
        "regex_rules",
        "preserve_source_fields",
    }
)

_FULL_EVENT_JSONATA = "full_event_jsonata"
_FULL_EVENT_REGEX = "full_event_regex"


def get_mapping_mode(field_mappings: dict[str, Any] | None) -> str | None:
    if not isinstance(field_mappings, dict):
        return None
    raw = field_mappings.get("mapping_mode")
    if raw is None:
        return None
    mode = str(raw).strip().lower()
    return mode or None


def is_full_event_mapping(field_mappings: dict[str, Any] | None) -> bool:
    mode = get_mapping_mode(field_mappings)
    return mode in {_FULL_EVENT_JSONATA, _FULL_EVENT_REGEX}


def extract_basic_jsonpath_mappings(field_mappings: dict[str, Any] | None) -> dict[str, str]:
    """Plain JSONPath output→path entries; skips meta keys and non-string values."""

    if not isinstance(field_mappings, dict):
        return {}
    out: dict[str, str] = {}
    for key, value in field_mappings.items():
        if key in FIELD_MAPPINGS_META_KEYS or str(key).startswith("_"):
            continue
        if isinstance(value, str):
            path = value.strip()
            if path:
                out[str(key)] = path
    return out


def _coerce_regex_source(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, (list, dict)):
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    return str(value)


def _parse_regex_rules(field_mappings: dict[str, Any]) -> list[dict[str, Any]]:
    raw = field_mappings.get("regex_rules")
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def apply_full_event_regex_mapping(
    event: dict[str, Any],
    field_mappings: dict[str, Any],
) -> tuple[dict[str, Any], list[str], list[str]]:
    preserve = field_mappings.get("preserve_source_fields") is True
    base: dict[str, Any] = copy_json_value(event) if preserve else {}
    errors: list[str] = []
    warnings: list[str] = []
    rules = _parse_regex_rules(field_mappings)
    if not rules:
        errors.append('Full-event regex mapping requires a non-empty "regex_rules" array.')
        return base, errors, warnings

    for index, rule in enumerate(rules):
        output_field = str(rule.get("output_field") or rule.get("field") or "").strip()
        source_path = str(rule.get("source_path") or rule.get("path") or "").strip()
        pattern = str(rule.get("pattern") or "").strip()
        if not output_field or not source_path or not pattern:
            errors.append(f"regex_rules[{index}]: output_field, source_path, and pattern are required")
            continue

        group_raw = rule.get("capture_group", rule.get("group", 1))
        try:
            group_idx = int(group_raw)
        except (TypeError, ValueError):
            errors.append(f"regex_rules[{index}]: group must be an integer")
            continue
        if group_idx < 0:
            errors.append(f"regex_rules[{index}]: group must be non-negative")
            continue

        default_value = rule.get("default_value", rule.get("default"))

        raw_value = extract_one(event, source_path, default=None)
        source_text = _coerce_regex_source(raw_value)
        if source_text is None:
            if default_value is not None:
                base[output_field] = copy_json_value(default_value)
                warnings.append(f"{output_field}: source missing; used default")
            else:
                errors.append(f"{output_field}: source at {source_path} is missing")
            continue

        try:
            compiled = re.compile(pattern)
            match = compiled.search(source_text)
            capture_idx = group_idx if group_idx > 0 else 1
            if match is not None and capture_idx <= len(match.groups()):
                captured = match.group(capture_idx)
                if captured is not None:
                    base[output_field] = captured
                    continue
            if default_value is not None:
                base[output_field] = copy_json_value(default_value)
                warnings.append(f"{output_field}: no match; used default")
            else:
                errors.append(f"{output_field}: pattern did not match")
        except re.error as exc:
            errors.append(f"{output_field}: invalid pattern ({exc})")

    return base, errors, warnings


def apply_full_event_jsonata_mapping(
    event: dict[str, Any],
    field_mappings: dict[str, Any],
) -> tuple[dict[str, Any], list[str], list[str]]:
    expression = str(field_mappings.get("jsonata_expression") or "").strip()
    if not expression:
        return {}, ["Full-event JSONata mapping requires a non-empty jsonata_expression."], []

    try:
        import jsonata  # type: ignore[import-untyped]
    except ImportError as exc:
        raise MappingError(
            "JSONata engine is not installed; add jsonata-python to the runtime environment."
        ) from exc

    try:
        evaluator = jsonata.Jsonata(expression)
        result = evaluator.evaluate(event)
    except Exception as exc:  # noqa: BLE001 — surface expression errors to callers
        return {}, [f"JSONata evaluation failed: {exc}"], []

    if not isinstance(result, dict):
        return (
            {},
            ["JSONata must return a JSON object (not a string, number, boolean, array, or null)."],
            [],
        )

    return copy_json_value(result), [], []


def apply_full_event_mapping(
    event: dict[str, Any],
    field_mappings: dict[str, Any],
) -> tuple[dict[str, Any], list[str], list[str]]:
    if not isinstance(event, dict):
        raise MappingError(f"apply_full_event_mapping expects dict event, got {type(event).__name__}")

    mode = get_mapping_mode(field_mappings)
    if mode == _FULL_EVENT_JSONATA:
        return apply_full_event_jsonata_mapping(event, field_mappings)
    if mode == _FULL_EVENT_REGEX:
        return apply_full_event_regex_mapping(event, field_mappings)
    raise MappingError(f"Unsupported full-event mapping mode: {mode!r}")


__all__ = [
    "FIELD_MAPPINGS_META_KEYS",
    "apply_full_event_jsonata_mapping",
    "apply_full_event_mapping",
    "apply_full_event_regex_mapping",
    "extract_basic_jsonpath_mappings",
    "get_mapping_mode",
    "is_full_event_mapping",
]
