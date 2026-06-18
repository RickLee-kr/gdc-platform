"""Route-scoped classification operator API (M13.4 P2)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.classification.models import StreamClassificationRule
from app.route_classification.models import RouteClassificationRule
from app.route_classification.operator_workflow import _load_route
from app.route_classification.resolver import resolve_route_classification_config
from app.route_classification.schemas import RouteClassificationEffectiveResponse


def get_route_classification_effective(db: Session, route_id: int) -> RouteClassificationEffectiveResponse:
    route = _load_route(db, route_id)
    stream_id = int(route.stream_id)

    route_rule_rows = list(
        db.execute(select(RouteClassificationRule).where(RouteClassificationRule.route_id == route_id)).scalars()
    )
    stream_rule_rows = list(
        db.execute(
            select(StreamClassificationRule).where(StreamClassificationRule.stream_id == stream_id)
        ).scalars()
    )

    config = resolve_route_classification_config(
        route_id=route_id,
        stream_id=stream_id,
        route_classification_rules=route_rule_rows,
        stream_classification_rules=stream_rule_rows,
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

    return RouteClassificationEffectiveResponse(
        route_id=route_id,
        stream_id=stream_id,
        persisted_source=api_persisted,  # type: ignore[arg-type]
        fallback_used=fallback_used,
        rule_count=len(config.rules),
        processing_status=processing_status,  # type: ignore[arg-type]
        message="Route classification effective config resolved successfully",
    )
