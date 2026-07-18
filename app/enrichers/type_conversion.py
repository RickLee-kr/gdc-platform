"""Type Conversion transform for enrichment ``__rules``.

Coerces source field values to a target scalar/collection type with failure policies.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from app.enrichers.field_paths import is_valid_field_path

TargetType = Literal[
    "string",
    "integer",
    "long",
    "float",
    "double",
    "boolean",
    "datetime",
    "array",
    "object",
    "json",
]
OnFailure = Literal["keep_original", "set_null", "drop_field", "skip_event"]

TARGET_TYPES: frozenset[str] = frozenset(
    {"string", "integer", "long", "float", "double", "boolean", "datetime", "array", "object", "json"}
)
ON_FAILURE_POLICIES: frozenset[str] = frozenset(
    {"keep_original", "set_null", "drop_field", "skip_event"}
)

_TRUE_STRINGS = frozenset({"true", "1", "yes", "y", "on"})
_FALSE_STRINGS = frozenset({"false", "0", "no", "n", "off"})


class TypeConversionError(ValueError):
    """Raised when a value cannot be converted to the requested type."""


@dataclass(frozen=True, slots=True)
class TypeConversionResult:
    value: Any
    skipped: bool = False
    dropped: bool = False
    warning: str | None = None


def normalize_target_type(raw: object) -> str:
    key = str(raw or "").strip().lower().replace("-", "_")
    aliases = {
        "str": "string",
        "int": "integer",
        "bool": "boolean",
        "list": "array",
        "dict": "object",
        "map": "object",
    }
    key = aliases.get(key, key)
    if key not in TARGET_TYPES:
        raise TypeConversionError(f"Unsupported target_type {raw!r}")
    return key


def normalize_on_failure(raw: object) -> str:
    key = str(raw or "keep_original").strip().lower().replace("-", "_")
    aliases = {
        "keep": "keep_original",
        "null": "set_null",
        "drop": "drop_field",
        "skip": "skip_event",
    }
    key = aliases.get(key, key)
    if key not in ON_FAILURE_POLICIES:
        raise TypeConversionError(f"Unsupported on_failure {raw!r}")
    return key


def is_type_conversion_field_path(path: str) -> bool:
    return is_valid_field_path(path)


def _to_boolean(raw: Any) -> bool:
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return raw != 0
    text = str(raw).strip().lower()
    if text in _TRUE_STRINGS:
        return True
    if text in _FALSE_STRINGS:
        return False
    raise TypeConversionError(f"Cannot convert {raw!r} to boolean")


def _to_integer(raw: Any) -> int:
    if isinstance(raw, bool):
        return int(raw)
    if isinstance(raw, int):
        return raw
    if isinstance(raw, float):
        return int(raw)
    text = str(raw).strip()
    if not text:
        raise TypeConversionError("Empty value cannot convert to integer")
    try:
        return int(float(text))
    except ValueError as exc:
        raise TypeConversionError(f"Cannot convert {raw!r} to integer") from exc


def _to_float(raw: Any) -> float:
    if isinstance(raw, bool):
        return float(int(raw))
    if isinstance(raw, (int, float)):
        return float(raw)
    text = str(raw).strip()
    if not text:
        raise TypeConversionError("Empty value cannot convert to float")
    try:
        return float(text)
    except ValueError as exc:
        raise TypeConversionError(f"Cannot convert {raw!r} to float") from exc


def _to_datetime(raw: Any) -> str:
    if isinstance(raw, datetime):
        aware = raw if raw.tzinfo is not None else raw.replace(tzinfo=UTC)
        return aware.astimezone(UTC).isoformat().replace("+00:00", "Z")
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        n = abs(float(raw))
        if n < 1e11:
            seconds = float(raw)
        elif n < 1e14:
            seconds = float(raw) / 1000.0
        elif n < 1e17:
            seconds = float(raw) / 1_000_000.0
        else:
            seconds = float(raw) / 1_000_000_000.0
        try:
            return datetime.fromtimestamp(seconds, tz=UTC).isoformat().replace("+00:00", "Z")
        except (OverflowError, OSError, ValueError) as exc:
            raise TypeConversionError(f"Epoch out of range: {raw}") from exc
    text = str(raw).strip()
    if not text:
        raise TypeConversionError("Empty value cannot convert to datetime")
    normalized = text.replace(" ", "T")
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise TypeConversionError(f"Invalid datetime string: {raw!r}") from exc
    aware = dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)
    return aware.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _to_array(raw: Any) -> list[Any]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, tuple):
        return list(raw)
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            raise TypeConversionError("Empty string cannot convert to array")
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise TypeConversionError(f"Invalid JSON array string: {raw!r}") from exc
        if not isinstance(parsed, list):
            raise TypeConversionError(f"JSON value is not an array: {type(parsed).__name__}")
        return parsed
    raise TypeConversionError(f"Cannot convert {type(raw).__name__} to array")


def _to_object(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            raise TypeConversionError("Empty string cannot convert to object")
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise TypeConversionError(f"Invalid JSON object string: {raw!r}") from exc
        if not isinstance(parsed, dict):
            raise TypeConversionError(f"JSON value is not an object: {type(parsed).__name__}")
        return parsed
    raise TypeConversionError(f"Cannot convert {type(raw).__name__} to object")


def _to_json(raw: Any) -> Any:
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            raise TypeConversionError("Empty string cannot convert to JSON")
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise TypeConversionError(f"Invalid JSON string: {raw!r}") from exc
    return raw


def coerce_value(raw: Any, *, target_type: str) -> Any:
    """Convert ``raw`` to ``target_type`` or raise ``TypeConversionError``."""

    tt = normalize_target_type(target_type)
    if raw is None:
        if tt in {"string"}:
            return ""
        if tt in {"array"}:
            return []
        if tt in {"object"}:
            return {}
        raise TypeConversionError("Cannot convert null")

    if tt == "string":
        if isinstance(raw, (dict, list)):
            return json.dumps(raw, ensure_ascii=False)
        return str(raw)
    if tt in {"integer", "long"}:
        return _to_integer(raw)
    if tt in {"float", "double"}:
        return _to_float(raw)
    if tt == "boolean":
        return _to_boolean(raw)
    if tt == "datetime":
        return _to_datetime(raw)
    if tt == "array":
        return _to_array(raw)
    if tt == "object":
        return _to_object(raw)
    if tt == "json":
        return _to_json(raw)
    raise TypeConversionError(f"Unsupported target_type {target_type!r}")


def convert_type(
    raw: Any,
    *,
    target_type: str,
    on_failure: str = "keep_original",
) -> TypeConversionResult:
    failure = normalize_on_failure(on_failure)
    try:
        value = coerce_value(raw, target_type=target_type)
        return TypeConversionResult(value=value)
    except TypeConversionError as exc:
        if failure == "keep_original":
            return TypeConversionResult(value=raw, warning=str(exc))
        if failure == "set_null":
            return TypeConversionResult(value=None, warning=str(exc))
        if failure == "drop_field":
            return TypeConversionResult(value=None, dropped=True, warning=str(exc))
        if failure == "skip_event":
            return TypeConversionResult(value=None, skipped=True, warning=str(exc))
        raise


def preview_conversion_safe(raw: Any, *, target_type: str) -> tuple[Any | None, str | None]:
    """Return converted value or (None, warning) for UI preview."""

    try:
        return coerce_value(raw, target_type=target_type), None
    except TypeConversionError as exc:
        return None, str(exc)


__all__ = [
    "ON_FAILURE_POLICIES",
    "TARGET_TYPES",
    "TypeConversionError",
    "TypeConversionResult",
    "coerce_value",
    "convert_type",
    "is_type_conversion_field_path",
    "normalize_on_failure",
    "normalize_target_type",
    "preview_conversion_safe",
]
