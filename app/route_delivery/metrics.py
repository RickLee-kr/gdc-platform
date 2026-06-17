"""Route delivery metrics rollup (M13.6)."""

from __future__ import annotations

from app.route_delivery.config import RouteDeliveryResult


def apply_delivery_metrics(
    metrics: object,
    delivery_result: RouteDeliveryResult,
) -> None:
    """Increment route_delivery_* counters on RouteProcessingMetrics."""

    metrics.route_delivery_attempt_count = int(getattr(metrics, "route_delivery_attempt_count", 0) or 0) + 1
    disposition = delivery_result.delivery_disposition
    policy_action = delivery_result.policy_action

    if disposition == "delivered" and delivery_result.delivery_success is True:
        metrics.route_delivery_success_count = int(getattr(metrics, "route_delivery_success_count", 0) or 0) + 1
    elif disposition == "delivered" and delivery_result.delivery_success is False:
        metrics.route_delivery_failure_count = int(getattr(metrics, "route_delivery_failure_count", 0) or 0) + 1
    elif disposition == "quarantined":
        metrics.route_delivery_quarantine_count = int(getattr(metrics, "route_delivery_quarantine_count", 0) or 0) + 1
    elif disposition == "blocked" and policy_action == "require_review":
        metrics.route_delivery_review_count = int(getattr(metrics, "route_delivery_review_count", 0) or 0) + 1
    elif disposition == "blocked":
        metrics.route_delivery_blocked_count = int(getattr(metrics, "route_delivery_blocked_count", 0) or 0) + 1
