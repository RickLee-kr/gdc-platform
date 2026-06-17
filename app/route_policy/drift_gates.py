"""Shared schema drift signals with route-aware escalation (M13.5)."""

from __future__ import annotations

from typing import Any

from app.route_policy.governance_behavior import normalize_delivery_behavior


def derive_drift_gates(
    schema_drift_policy_result: Any | None,
    *,
    route_id: int,
    route_overrides: list[dict[str, Any]] | None = None,
) -> tuple[bool, bool]:
    """Return (review_required, quarantine_required) for one route without re-running drift."""

    review_required = False
    quarantine_required = False

    if schema_drift_policy_result is not None:
        if bool(getattr(schema_drift_policy_result, "should_quarantine", False)):
            quarantine_required = True
        batch_action = str(getattr(schema_drift_policy_result, "batch_action", "") or "")
        if batch_action == "require_review":
            review_required = True
        review_fields = getattr(schema_drift_policy_result, "review_fields", None)
        if review_fields:
            review_required = True

    override_behavior = None
    for override in route_overrides or []:
        if int(override.get("route_id", -1)) != int(route_id):
            continue
        if not bool(override.get("enabled", True)):
            continue
        override_behavior = normalize_delivery_behavior(override.get("delivery_behavior"))
        if override_behavior is not None:
            break

    if override_behavior == "quarantine":
        quarantine_required = True
    elif override_behavior == "require_review":
        review_required = True

    return review_required, quarantine_required
