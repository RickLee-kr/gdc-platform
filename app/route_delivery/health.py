"""Route delivery health classification (M13.6)."""

from __future__ import annotations

from app.route_delivery.config import DeliveryDisposition, RouteHealthLevel, RouteSendOutcome


def classify_route_delivery_health(
    *,
    delivery_disposition: DeliveryDisposition,
    delivery_success: bool | None,
    send_outcome: RouteSendOutcome | None = None,
) -> RouteHealthLevel:
    """Map disposition to operator-facing route health for runtime timeline."""

    if delivery_disposition == "quarantined":
        return "failed"
    if delivery_disposition == "blocked":
        return "warning"
    if delivery_disposition == "delivered_review_required":
        return "warning"
    if delivery_disposition == "delivered":
        if delivery_success is False:
            return "failed"
        if send_outcome is not None and send_outcome.rate_limited:
            return "warning"
        if delivery_success is True:
            return "healthy"
    return "healthy"
