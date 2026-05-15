"""DB repository for routes."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.routes.models import Route


def get_enabled_routes_by_stream_id(db: Session, stream_id: int) -> list[Route]:
    """Return enabled routes using DB-side filtering."""

    return (
        db.query(Route)
        .filter(Route.stream_id == stream_id, Route.enabled == True)  # noqa: E712
        .all()
    )


def update_route_status(db: Session, route_id: int, status: str) -> Route | None:
    """Update route status by route id."""

    route = db.query(Route).filter(Route.id == route_id).first()
    if route is None:
        return None

    route.status = status
    db.add(route)
    return route


def disable_route(db: Session, route_id: int) -> Route | None:
    """Disable route and set DISABLED status."""

    route = db.query(Route).filter(Route.id == route_id).first()
    if route is None:
        return None

    route.enabled = False
    if hasattr(route, "status"):
        route.status = "DISABLED"
    db.add(route)
    return route
