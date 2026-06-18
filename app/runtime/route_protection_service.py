"""Route-scoped protection operator API (M13.3 P2)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.protection.engine import protection_enabled
from app.protection.models import StreamProtectionRule
from app.route_protection.models import RouteProtectionRule
from app.route_protection.operator_workflow import _load_route
from app.route_protection.resolver import resolve_route_protection_config
from app.route_protection.schemas import RouteProtectionEffectiveResponse
from app.runtime.control_service import RouteNotFoundError


def get_route_protection_effective(db: Session, route_id: int) -> RouteProtectionEffectiveResponse:
    route = _load_route(db, route_id)
    stream_id = int(route.stream_id)

    route_rule_rows = list(
        db.execute(select(RouteProtectionRule).where(RouteProtectionRule.route_id == route_id)).scalars()
    )
    stream_rule_rows = list(
        db.execute(
            select(StreamProtectionRule).where(StreamProtectionRule.stream_id == stream_id)
        ).scalars()
    )

    config = resolve_route_protection_config(
        route_id=route_id,
        stream_id=stream_id,
        route_protection_rules=route_rule_rows,
        stream_protection_rules=stream_rule_rows,
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

    return RouteProtectionEffectiveResponse(
        route_id=route_id,
        stream_id=stream_id,
        persisted_source=api_persisted,  # type: ignore[arg-type]
        fallback_used=fallback_used,
        rule_count=len(config.rules),
        processing_status=processing_status,  # type: ignore[arg-type]
        message="Route protection effective config resolved successfully",
    )


__all__ = ["RouteNotFoundError", "get_route_protection_effective"]
