"""Strip internal enrichment keys from delivery-bound events."""

from __future__ import annotations

from typing import Any

from app.runtime.copy_utils import copy_json_value

_RESERVED_EVENT_KEYS = frozenset(
    {
        "__rules",
        "__computed",
        "__preview",
        "__enrichment_meta",
        "__enrichment_warnings",
        "__validation",
    }
)


def sanitize_delivery_event(event: dict[str, Any]) -> dict[str, Any]:
    """Return a copy safe for formatter/destination payloads."""

    out = copy_json_value(event)
    for key in list(out.keys()):
        if key in _RESERVED_EVENT_KEYS or (isinstance(key, str) and key.startswith("__")):
            del out[key]
    return _strip_internal_nested(out)


def _strip_internal_nested(value: Any) -> Any:
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for k, v in value.items():
            if isinstance(k, str) and k.startswith("__"):
                continue
            cleaned[k] = _strip_internal_nested(v)
        return cleaned
    if isinstance(value, list):
        return [_strip_internal_nested(item) for item in value]
    return value
