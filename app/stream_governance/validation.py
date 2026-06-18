"""Validation and normalization for stream governance Contract v1."""

from __future__ import annotations

import uuid
from typing import Any

from app.stream_governance.constants import ALLOWED_DELIVERY_BEHAVIORS, ALLOWED_PROTECTION_ACTIONS
from app.stream_governance.errors import StreamGovernanceValidationError


def normalize_field_path(raw: Any) -> str:
    path = str(raw or "").strip()
    if not path:
        raise StreamGovernanceValidationError(
            "INVALID_ROUTE_OVERRIDE_FIELD",
            "field_path is required",
        )
    if not path.startswith("$"):
        raise StreamGovernanceValidationError(
            "INVALID_ROUTE_OVERRIDE_FIELD",
            f"field_path must be a JSONPath starting with $: {path!r}",
        )
    return path


def _normalize_delivery_behavior(raw: Any) -> str | None:
    if raw is None:
        return None
    value = str(raw).strip().lower()
    if not value:
        return None
    if value not in ALLOWED_DELIVERY_BEHAVIORS:
        raise StreamGovernanceValidationError(
            "INVALID_DELIVERY_BEHAVIOR",
            f"invalid delivery_behavior: {raw!r}",
        )
    return value


def _normalize_protection_action(raw: Any, *, enabled: bool) -> str | None:
    if raw is None or str(raw).strip() == "":
        if enabled:
            raise StreamGovernanceValidationError(
                "ROUTE_OVERRIDE_MISSING_ACTION",
                "protection_action is required when override is enabled",
            )
        return None
    value = str(raw).strip().lower()
    if value == "inherit":
        raise StreamGovernanceValidationError(
            "INVALID_PROTECTION_ACTION",
            "protection_action 'inherit' must not be persisted; omit override to inherit stream default",
        )
    if value not in ALLOWED_PROTECTION_ACTIONS:
        raise StreamGovernanceValidationError(
            "INVALID_PROTECTION_ACTION",
            f"invalid protection_action: {raw!r}",
        )
    return value


def _normalize_override_record(
    raw: dict[str, Any],
    *,
    field_path: str,
    seen: set[tuple[str, int]],
) -> dict[str, Any]:
    enabled = bool(raw.get("enabled", True))
    route_id_raw = raw.get("route_id")
    if route_id_raw is None:
        raise StreamGovernanceValidationError(
            "INVALID_ROUTE_OVERRIDE_ROUTE",
            "route_id is required on route override",
        )
    try:
        route_id = int(route_id_raw)
    except (TypeError, ValueError) as exc:
        raise StreamGovernanceValidationError(
            "INVALID_ROUTE_OVERRIDE_ROUTE",
            f"invalid route_id: {route_id_raw!r}",
        ) from exc

    path = normalize_field_path(raw.get("field_path") or field_path)
    key = (path, route_id)
    if key in seen:
        raise StreamGovernanceValidationError(
            "INVALID_ROUTE_OVERRIDE_DUPLICATE",
            f"duplicate route override for field_path={path!r} route_id={route_id}",
        )
    seen.add(key)

    protection_action = _normalize_protection_action(raw.get("protection_action"), enabled=enabled)
    delivery_behavior = _normalize_delivery_behavior(raw.get("delivery_behavior"))

    override_key = str(raw.get("override_key") or "").strip() or f"ovr-{uuid.uuid4().hex[:12]}"

    return {
        "override_key": override_key,
        "field_path": path,
        "route_id": route_id,
        "protection_action": protection_action,
        "delivery_behavior": delivery_behavior,
        "enabled": enabled,
    }


def flatten_route_overrides(
    rules: list[dict[str, Any]] | None,
    flat_overrides: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Merge nested rule overrides and flat overrides into canonical flat list."""

    seen: set[tuple[str, int]] = set()
    normalized: list[dict[str, Any]] = []

    for item in flat_overrides or []:
        if not isinstance(item, dict):
            raise StreamGovernanceValidationError(
                "INVALID_ROUTE_OVERRIDE",
                "route_overrides entries must be objects",
            )
        normalized.append(_normalize_override_record(item, field_path="", seen=seen))

    for rule in rules or []:
        if not isinstance(rule, dict):
            continue
        rule_path = str(rule.get("field_path") or "").strip()
        for nested in rule.get("route_overrides") or []:
            if not isinstance(nested, dict):
                raise StreamGovernanceValidationError(
                    "INVALID_ROUTE_OVERRIDE",
                    "nested route_overrides entries must be objects",
                )
            merged = dict(nested)
            if not merged.get("field_path"):
                if not rule_path:
                    raise StreamGovernanceValidationError(
                        "INVALID_ROUTE_OVERRIDE_FIELD",
                        "nested route override requires parent rule field_path",
                    )
                merged["field_path"] = rule_path
            normalized.append(_normalize_override_record(merged, field_path=rule_path, seen=seen))

    return normalized


def validate_route_ids_belong_to_stream(
    overrides: list[dict[str, Any]],
    *,
    valid_route_ids: set[int],
) -> None:
    for item in overrides:
        route_id = int(item["route_id"])
        if route_id not in valid_route_ids:
            raise StreamGovernanceValidationError(
                "INVALID_ROUTE_OVERRIDE_ROUTE",
                f"route_id {route_id} does not belong to stream",
            )


def normalize_governance_rules(rules: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Normalize governance rules for persistence (nested overrides kept for authoring mirror)."""

    out: list[dict[str, Any]] = []
    for raw in rules or []:
        if not isinstance(raw, dict):
            continue
        field_path = normalize_field_path(raw.get("field_path"))
        default_action = raw.get("default_protection_action", "audit")
        if str(default_action).strip().lower() not in ALLOWED_PROTECTION_ACTIONS:
            raise StreamGovernanceValidationError(
                "INVALID_PROTECTION_ACTION",
                f"invalid default_protection_action: {default_action!r}",
            )
        default_delivery = raw.get("default_delivery_behavior", "continue")
        _normalize_delivery_behavior(default_delivery)

        nested_out: list[dict[str, Any]] = []
        for nested in raw.get("route_overrides") or []:
            if not isinstance(nested, dict):
                continue
            nested_enabled = bool(nested.get("enabled", True))
            nested_action = nested.get("protection_action")
            if nested_enabled and nested_action is not None:
                _normalize_protection_action(nested_action, enabled=True)
            nested_out.append(
                {
                    "route_id": int(nested["route_id"]),
                    "protection_action": nested_action,
                    "delivery_behavior": _normalize_delivery_behavior(nested.get("delivery_behavior")),
                    "enabled": nested_enabled,
                    "override_key": str(nested.get("override_key") or "").strip() or None,
                }
            )

        out.append(
            {
                "rule_key": str(raw.get("rule_key") or "").strip() or f"rule-{uuid.uuid4().hex[:12]}",
                "field_path": field_path,
                "sensitivity_type": raw.get("sensitivity_type"),
                "default_protection_action": str(default_action).strip().lower(),
                "default_delivery_behavior": str(default_delivery).strip().lower(),
                "enabled": bool(raw.get("enabled", True)),
                "route_overrides": nested_out,
            }
        )
    return out
