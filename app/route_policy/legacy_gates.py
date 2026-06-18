"""Legacy fan-out per-route delivery_behavior gates (flag OFF, override-only)."""

from __future__ import annotations

from typing import Any

from app.protection.policy_engine import PolicyBatchResult
from app.route_policy.decision import delivery_allowed_for_decision, merge_route_policy_decision
from app.route_policy.governance_behavior import normalize_delivery_behavior
from app.route_policy.resolver import resolve_route_policy_config


def _get(data: Any, key: str, default: Any = None) -> Any:
    if isinstance(data, dict):
        return data.get(key, default)
    return getattr(data, key, default)


def has_active_delivery_behavior_route_overrides(route_overrides: list[dict[str, Any]] | None) -> bool:
    """True when at least one enabled override carries an explicit delivery_behavior."""

    for item in route_overrides or []:
        if not isinstance(item, dict):
            continue
        if not bool(item.get("enabled", True)):
            continue
        if normalize_delivery_behavior(item.get("delivery_behavior")) is not None:
            return True
    return False


def _route_is_actionable(route: dict[str, Any]) -> bool:
    if not bool(_get(route, "enabled", True)):
        return False
    destination = _get(route, "destination", {}) or {}
    return bool(_get(destination, "enabled", True))


def build_legacy_route_delivery_gates(
    *,
    runtime_stream: Any,
    schema_drift_policy_result: Any = None,
) -> dict[int, bool]:
    """Per-route delivery_allowed for legacy fan-out (governance override + drift only).

    Stream-level policy already ran in ``_evaluate_policies()``; this bridge applies only
    per-route ``delivery_behavior`` overrides and shared drift escalation.
    """

    stream_id = int(_get(runtime_stream, "id"))
    route_overrides = list(_get(runtime_stream, "route_overrides", []) or [])
    empty_batch = PolicyBatchResult(duration_ms=0)
    gates: dict[int, bool] = {}

    for route in list(_get(runtime_stream, "routes", []) or []):
        if not _route_is_actionable(route):
            continue
        route_id = int(_get(route, "id"))
        config = resolve_route_policy_config(
            route_id=route_id,
            stream_id=stream_id,
            route_policy_rules=[],
            stream_policy_rules=[],
            route_overrides=route_overrides,
            schema_drift_policy_result=schema_drift_policy_result,
        )
        decision, _ = merge_route_policy_decision(empty_batch, config)
        gates[route_id] = delivery_allowed_for_decision(decision)

    return gates


def apply_legacy_delivery_behavior_gates(
    *,
    runtime_stream: Any,
    existing_route_payloads: dict[int, list[dict[str, Any]]] | None = None,
    schema_drift_policy_result: Any = None,
) -> dict[int, list[dict[str, Any]]] | None:
    """Block legacy fan-out routes by setting empty payloads when delivery is not allowed."""

    gates = build_legacy_route_delivery_gates(
        runtime_stream=runtime_stream,
        schema_drift_policy_result=schema_drift_policy_result,
    )
    blocked_route_ids = {route_id for route_id, allowed in gates.items() if not allowed}
    if not blocked_route_ids:
        return existing_route_payloads

    payloads = dict(existing_route_payloads or {})
    for route_id in blocked_route_ids:
        payloads[route_id] = []
    return payloads
