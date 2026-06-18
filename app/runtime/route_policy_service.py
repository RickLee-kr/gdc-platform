"""Route-scoped policy operator API (M13.5 P2)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.protection.models import StreamPolicyRule
from app.route_policy.models import RoutePolicyRule
from app.route_policy.operator_workflow import _load_route
from app.route_policy.resolver import resolve_route_policy_config
from app.route_policy.schemas import RoutePolicyEffectiveResponse


def get_route_policy_effective(db: Session, route_id: int) -> RoutePolicyEffectiveResponse:
    route = _load_route(db, route_id)
    stream_id = int(route.stream_id)

    route_rule_rows = list(
        db.execute(select(RoutePolicyRule).where(RoutePolicyRule.route_id == route_id)).scalars()
    )
    stream_rule_rows = list(
        db.execute(select(StreamPolicyRule).where(StreamPolicyRule.stream_id == stream_id)).scalars()
    )

    config = resolve_route_policy_config(
        route_id=route_id,
        stream_id=stream_id,
        route_policy_rules=route_rule_rows,
        stream_policy_rules=stream_rule_rows,
    )

    persisted = config.resolution.persisted_source
    api_persisted: str = "stream" if persisted in ("stream", "empty") else "route"
    fallback_used = bool(config.resolution.fallback_used)
    route_enabled_rows = [r for r in route_rule_rows if bool(r.enabled)]

    if persisted == "route":
        processing_status = "Overridden"
    elif persisted == "stream" and route_rule_rows and not route_enabled_rows:
        processing_status = "Mixed"
    elif persisted == "stream":
        processing_status = "Inherited"
    elif route_rule_rows:
        processing_status = "Mixed"
    else:
        processing_status = "Inherited"

    return RoutePolicyEffectiveResponse(
        route_id=route_id,
        stream_id=stream_id,
        persisted_source=api_persisted,  # type: ignore[arg-type]
        fallback_used=fallback_used,
        rule_count=len(config.rules),
        processing_status=processing_status,  # type: ignore[arg-type]
    )
