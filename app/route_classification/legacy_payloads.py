"""Legacy fan-out per-route classification floor restamp (flag OFF, override-only)."""

from __future__ import annotations

from typing import Any

from app.classification.field_keys import read_classification_level, stamp_classification_level
from app.classification.levels import max_level, normalize_level
from app.classification.models import CLASSIFICATION_INTERNAL
from app.runtime.copy_utils import copy_events


def _get(data: Any, key: str, default: Any = None) -> Any:
    if isinstance(data, dict):
        return data.get(key, default)
    return getattr(data, key, default)


def has_active_classification_route_overrides(route_overrides: list[dict[str, Any]] | None) -> bool:
    """True when at least one enabled override carries a classification_level."""

    for item in route_overrides or []:
        if not isinstance(item, dict):
            continue
        if not bool(item.get("enabled", True)):
            continue
        if normalize_level(str(item.get("classification_level") or "")) is not None:
            return True
    return False


def _classification_floor_for_route(
    route_overrides: list[dict[str, Any]] | None,
    *,
    route_id: int,
) -> str | None:
    levels: list[str] = []
    for item in route_overrides or []:
        if not isinstance(item, dict):
            continue
        if int(item.get("route_id", -1)) != int(route_id):
            continue
        if not bool(item.get("enabled", True)):
            continue
        level = normalize_level(str(item.get("classification_level") or ""))
        if level is not None:
            levels.append(level)
    if not levels:
        return None
    return max_level(levels)


def _apply_classification_floor(events: list[dict[str, Any]], floor: str) -> list[dict[str, Any]]:
    out = copy_events(events)
    for event in out:
        if not isinstance(event, dict):
            continue
        current = read_classification_level(event) or CLASSIFICATION_INTERNAL
        effective = max_level([current, floor])
        stamp_classification_level(event, effective)
    return out


def _route_is_actionable(route: dict[str, Any]) -> bool:
    if not bool(_get(route, "enabled", True)):
        return False
    destination = _get(route, "destination", {}) or {}
    return bool(_get(destination, "enabled", True))


def build_legacy_route_classification_payloads(
    *,
    runtime_stream: Any,
    base_events: list[dict[str, Any]],
    existing_route_payloads: dict[int, list[dict[str, Any]]] | None = None,
) -> dict[int, list[dict[str, Any]]]:
    """Restamp classification_level per route using max(current, override floor)."""

    if not base_events:
        return dict(existing_route_payloads or {})

    route_overrides = list(_get(runtime_stream, "route_overrides", []) or [])
    if not has_active_classification_route_overrides(route_overrides):
        return dict(existing_route_payloads or {})

    payloads: dict[int, list[dict[str, Any]]] = dict(existing_route_payloads or {})
    for route in list(_get(runtime_stream, "routes", []) or []):
        if not _route_is_actionable(route):
            continue
        route_id = int(_get(route, "id"))
        floor = _classification_floor_for_route(route_overrides, route_id=route_id)
        if floor is None:
            continue
        source_events = payloads.get(route_id, base_events)
        payloads[route_id] = _apply_classification_floor(source_events, floor)

    return payloads
