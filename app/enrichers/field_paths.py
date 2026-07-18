"""Dot-path field access for enrichment target fields."""

from __future__ import annotations

import re
from typing import Any

from app.runtime.copy_utils import copy_json_value

# Allow ECS-style top-level keys such as ``@timestamp``.
_FIELD_PATH_RE = re.compile(r"^[A-Za-z_@][A-Za-z0-9_@]*(\.[A-Za-z_@][A-Za-z0-9_@]*)*$")


def get_field_value(event: dict[str, Any], path: str) -> Any:
    """Read a nested value using dot notation (e.g. ``metadata.severity``)."""

    key = path.strip()
    if not key:
        return None
    if "." not in key:
        return event.get(key)
    cur: Any = event
    for part in key.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def has_field_value(event: dict[str, Any], path: str) -> bool:
    """Return True when ``path`` resolves to a present value (including ``None`` at leaf)."""

    key = path.strip()
    if not key:
        return False
    if "." not in key:
        return key in event
    cur: Any = event
    parts = key.split(".")
    for part in parts[:-1]:
        if not isinstance(cur, dict) or part not in cur:
            return False
        cur = cur[part]
    if not isinstance(cur, dict):
        return False
    return parts[-1] in cur


def is_valid_field_path(path: str) -> bool:
    key = path.strip()
    if not key or key.startswith("__"):
        return False
    if ".." in key or key.endswith("."):
        return False
    return bool(_FIELD_PATH_RE.match(key))


def set_field_value(event: dict[str, Any], path: str, value: Any) -> bool:
    """Write ``value`` at ``path``. Returns False when path is invalid (no mutation)."""

    key = path.strip()
    if not key or not is_valid_field_path(key):
        return False
    try:
        if "." not in key:
            event[key] = copy_json_value(value)
            return True
        parts = key.split(".")
        cur = event
        for part in parts[:-1]:
            if not part:
                return False
            nxt = cur.get(part)
            if not isinstance(nxt, dict):
                nxt = {}
                cur[part] = nxt
            cur = nxt
        if not isinstance(cur, dict):
            return False
        cur[parts[-1]] = copy_json_value(value)
        return True
    except (TypeError, ValueError, RecursionError):
        return False
