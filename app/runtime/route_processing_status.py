"""Effective route processing_status — aligns display with runtime resolver inputs."""

from __future__ import annotations

from typing import Any, Literal

from sqlalchemy.orm import Session

from app.classification.levels import normalize_level
from app.route_policy.governance_behavior import normalize_delivery_behavior
from app.route_protection.resolver import map_protection_action_to_mode
from app.streams.models import Stream

ProcessingStatus = Literal["Inherited", "Overridden", "Mixed"]


def load_governance_route_overrides(db: Session, stream_id: int) -> list[dict[str, Any]]:
    """Load flattened governance route_overrides from stream.config_json."""

    stream = db.get(Stream, stream_id)
    if stream is None:
        return []
    config = stream.config_json if isinstance(stream.config_json, dict) else {}
    governance = config.get("governance")
    if not isinstance(governance, dict):
        return []
    raw = governance.get("route_overrides")
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def _override_matches_route(override: dict[str, Any], route_id: int) -> bool:
    return int(override.get("route_id", -1)) == int(route_id)


def _override_enabled(override: dict[str, Any]) -> bool:
    return bool(override.get("enabled", True))


def has_protection_governance_override_for_route(
    route_overrides: list[dict[str, Any]] | None,
    *,
    route_id: int,
) -> bool:
    for item in route_overrides or []:
        if not _override_matches_route(item, route_id) or not _override_enabled(item):
            continue
        action = map_protection_action_to_mode(item.get("protection_action"))
        if action is not None:
            return True
    return False


def has_classification_governance_override_for_route(
    route_overrides: list[dict[str, Any]] | None,
    *,
    route_id: int,
) -> bool:
    for item in route_overrides or []:
        if not _override_matches_route(item, route_id) or not _override_enabled(item):
            continue
        if normalize_level(str(item.get("classification_level") or "")) is not None:
            return True
    return False


def has_policy_governance_override_for_route(
    route_overrides: list[dict[str, Any]] | None,
    *,
    route_id: int,
) -> bool:
    for item in route_overrides or []:
        if not _override_matches_route(item, route_id) or not _override_enabled(item):
            continue
        if normalize_delivery_behavior(item.get("delivery_behavior")) is not None:
            return True
    return False


def compute_route_processing_status(
    *,
    persisted_source: str,
    route_rule_rows: list[Any],
    has_governance_override: bool,
) -> ProcessingStatus:
    """Map persisted bundle + governance override presence to processing_status."""

    route_enabled_rows = [row for row in route_rule_rows if bool(getattr(row, "enabled", True))]
    has_disabled_route_rows = bool(route_rule_rows) and not route_enabled_rows

    if persisted_source == "route":
        if has_governance_override:
            return "Mixed"
        return "Overridden"

    if persisted_source == "stream":
        if has_disabled_route_rows or has_governance_override:
            return "Mixed"
        return "Inherited"

    if has_governance_override:
        return "Overridden"
    if route_rule_rows:
        return "Mixed"
    return "Inherited"
