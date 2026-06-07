"""Load enabled failover rules for a stream (runtime + preview)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.destinations.models import Destination
from app.failover_routing.models import StreamFailoverRoute


@dataclass(frozen=True, slots=True)
class FailoverRouteBinding:
    failover_route_id: int
    stream_id: int
    primary_destination_id: int
    secondary_destination_id: int
    secondary_destination_type: str
    secondary_destination_config: dict[str, Any]
    secondary_destination_name: str
    secondary_destination_enabled: bool
    secondary_rate_limit_json: dict[str, Any]


def load_failover_bindings_by_primary(
    db: Session | None,
    stream_id: int,
) -> dict[int, FailoverRouteBinding]:
    if db is None:
        return {}

    rules = list(
        db.execute(
            select(StreamFailoverRoute)
            .where(
                StreamFailoverRoute.stream_id == int(stream_id),
                StreamFailoverRoute.enabled.is_(True),
            )
            .order_by(StreamFailoverRoute.id.asc())
        ).scalars()
    )
    out: dict[int, FailoverRouteBinding] = {}
    for rule in rules:
        primary_id = int(rule.primary_destination_id)
        if primary_id in out:
            continue
        secondary = db.get(Destination, int(rule.secondary_destination_id))
        if secondary is None:
            continue
        out[primary_id] = FailoverRouteBinding(
            failover_route_id=int(rule.id),
            stream_id=int(rule.stream_id),
            primary_destination_id=primary_id,
            secondary_destination_id=int(secondary.id),
            secondary_destination_type=str(secondary.destination_type or "").upper(),
            secondary_destination_config=dict(secondary.config_json or {}),
            secondary_destination_name=str(secondary.name or ""),
            secondary_destination_enabled=bool(secondary.enabled),
            secondary_rate_limit_json=dict(secondary.rate_limit_json or {}),
        )
    return out


def build_failover_plan_for_preview(
    db: Session | None,
    stream_id: int,
) -> list[dict[str, str]]:
    if db is None:
        return []
    stmt = (
        select(StreamFailoverRoute)
        .where(
            StreamFailoverRoute.stream_id == int(stream_id),
            StreamFailoverRoute.enabled.is_(True),
        )
        .order_by(StreamFailoverRoute.id.asc())
    )
    rules = list(db.execute(stmt).scalars())
    plan: list[dict[str, str]] = []
    for rule in rules:
        primary = db.get(Destination, int(rule.primary_destination_id))
        secondary = db.get(Destination, int(rule.secondary_destination_id))
        if primary is None or secondary is None:
            continue
        plan.append(
            {
                "primary": str(primary.name or f"destination-{primary.id}"),
                "secondary": str(secondary.name or f"destination-{secondary.id}"),
            }
        )
    return plan
