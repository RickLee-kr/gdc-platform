"""DB repository for destinations."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.destinations.models import Destination


def get_destination_by_id(db: Session, destination_id: int) -> Destination | None:
    """Return destination by primary key."""

    return db.query(Destination).filter(Destination.id == destination_id).first()


def get_destinations_for_routes(db: Session, routes: list[Any]) -> dict[int, Destination]:
    """Return destination map keyed by route.id."""

    destination_ids = {int(route.destination_id) for route in routes}
    if not destination_ids:
        return {}

    destinations = (
        db.query(Destination)
        .filter(Destination.id.in_(destination_ids), Destination.enabled == True)  # noqa: E712
        .all()
    )
    by_id = {int(destination.id): destination for destination in destinations}

    route_to_destination: dict[int, Destination] = {}
    for route in routes:
        destination = by_id.get(int(route.destination_id))
        if destination is not None:
            route_to_destination[int(route.id)] = destination
    return route_to_destination
