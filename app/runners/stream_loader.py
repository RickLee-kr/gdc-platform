"""Load DB-backed stream execution context."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.destinations.repository import get_destinations_for_routes
from app.enrichments.models import Enrichment
from app.mappings.models import Mapping
from app.routes.repository import get_enabled_routes_by_stream_id
from app.runtime.stream_context import StreamContext
from app.sources.models import Source
from app.streams.repository import get_stream_by_id
from app.checkpoints.repository import get_checkpoint_by_stream_id


def _get(data: Any, key: str, default: Any = None) -> Any:
    if isinstance(data, dict):
        return data.get(key, default)
    return getattr(data, key, default)


def _extract_stream_config(stream: Any) -> dict[str, Any]:
    return stream.config_json or {}


def _extract_source_config(source: Any) -> dict[str, Any]:
    config = source.config_json or {}
    auth = source.auth_json or {}
    if auth:
        merged = dict(config)
        merged.update(auth)
        return merged
    return config


def load_stream_context(db: Session, stream_id: int) -> StreamContext:
    """Load stream/source/mapping/enrichment/routes/destinations/checkpoint."""

    stream = get_stream_by_id(db, stream_id)
    if stream is None:
        raise ValueError(f"stream not found: {stream_id}")
    if not bool(stream.enabled):
        raise ValueError(f"stream disabled: {stream_id}")

    source = db.query(Source).filter(Source.id == int(stream.source_id)).first()
    if source is None:
        raise ValueError(f"source not found for stream {stream_id}")

    mapping = db.query(Mapping).filter(Mapping.stream_id == stream_id).first()
    enrichment = db.query(Enrichment).filter(Enrichment.stream_id == stream_id).first()

    routes = get_enabled_routes_by_stream_id(db, stream_id)
    if not routes:
        raise ValueError(f"no enabled routes for stream {stream_id}")

    destination_by_route = get_destinations_for_routes(db, routes)
    if not destination_by_route:
        raise ValueError(f"no destinations for enabled routes of stream {stream_id}")

    runtime_routes: list[dict[str, Any]] = []
    for route in routes:
        route_id = int(_get(route, "id"))
        destination = destination_by_route.get(route_id)
        if destination is None:
            raise ValueError(f"destination missing for route {route_id}")
        runtime_routes.append(
            {
                "id": route_id,
                "enabled": bool(route.enabled),
                "failure_policy": route.failure_policy,
                "retry_count": _get(route, "retry_count", 2),
                "backoff_seconds": _get(route, "backoff_seconds", 1.0),
                "destination": {
                    "id": int(destination.id),
                    "destination_type": destination.destination_type,
                    "config": destination.config_json or {},
                    "enabled": bool(destination.enabled),
                },
            }
        )

    checkpoint_row = get_checkpoint_by_stream_id(db, stream_id)
    checkpoint = None
    if checkpoint_row is not None:
        checkpoint = {
            "type": checkpoint_row.checkpoint_type,
            "value": checkpoint_row.checkpoint_value_json,
        }

    stream_runtime = {
        "id": int(stream.id),
        "enabled": bool(stream.enabled),
        "status": stream.status,
        "source_id": int(stream.source_id),
        "stream_config": _extract_stream_config(stream),
        "source_config": _extract_source_config(source),
        "field_mappings": mapping.field_mappings_json if mapping else {},
        "enrichment": enrichment.enrichment_json if enrichment else {},
        "override_policy": enrichment.override_policy if enrichment else "KEEP_EXISTING",
        "routes": runtime_routes,
    }

    return StreamContext(
        stream=stream_runtime,
        source=source,
        mapping=mapping,
        enrichment=enrichment,
        routes=runtime_routes,
        destinations_by_route=destination_by_route,
        checkpoint=checkpoint,
    )
