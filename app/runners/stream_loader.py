"""Load DB-backed stream execution context."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.ai_providers.destination_config import resolve_ai_provider_destination_config
from app.ai_providers.service import provider_runtime_bundle
from app.destinations.repository import get_destinations_for_routes
from app.enrichments.models import Enrichment
from app.mappings.models import Mapping
from app.routes.repository import get_enabled_routes_by_stream_id
from app.runtime.stream_context import StreamContext
from app.sources.models import Source
from app.streams.repository import get_stream_by_id
from app.checkpoints.repository import get_checkpoint_by_stream_id
from app.pollers.http_query_params import coerce_stream_body_fields_to_json_objects


def _get(data: Any, key: str, default: Any = None) -> Any:
    if isinstance(data, dict):
        return data.get(key, default)
    return getattr(data, key, default)


def _extract_stream_config(stream: Any) -> dict[str, Any]:
    return stream.config_json or {}


def _extract_source_config(source: Any) -> dict[str, Any]:
    config = source.config_json or {}
    st = str(getattr(source, "source_type", "") or "").strip().upper()
    if st in {"DATABASE_QUERY", "REMOTE_FILE_POLLING", "REMOTE_FILE"}:
        return dict(config)
    auth = source.auth_json or {}
    if auth:
        merged = dict(config)
        merged.update(auth)
        return merged
    return config


def load_stream_context(
    db: Session,
    stream_id: int,
    *,
    require_enabled_stream: bool = True,
    preloaded_stream: Any | None = None,
    preloaded_source: Any | None = None,
    preloaded_ai_provider: Any | None = None,
    ai_stream_id: int | None = None,
) -> StreamContext:
    """Load stream/source/mapping/enrichment/routes/destinations/checkpoint."""

    stream = preloaded_stream if preloaded_stream is not None else get_stream_by_id(db, stream_id)
    if stream is None:
        raise ValueError(f"stream not found: {stream_id}")
    if int(stream.id) != int(stream_id):
        raise ValueError(f"preloaded stream id mismatch: {stream_id}")
    if require_enabled_stream and not bool(stream.enabled):
        raise ValueError(f"stream disabled: {stream_id}")

    if preloaded_source is not None:
        source = preloaded_source
    else:
        source = db.query(Source).filter(Source.id == int(stream.source_id)).first()
    if source is None:
        raise ValueError(f"source not found for stream {stream_id}")

    mapping = db.query(Mapping).filter(Mapping.stream_id == stream_id).first()
    enrichment = db.query(Enrichment).filter(Enrichment.stream_id == stream_id).first()

    routes = get_enabled_routes_by_stream_id(db, stream_id)
    if not routes:
        raise ValueError(f"no enabled routes for stream {stream_id}")

    destination_by_route = get_destinations_for_routes(db, routes)

    runtime_routes: list[dict[str, Any]] = []
    for route in routes:
        route_id = int(_get(route, "id"))
        destination = destination_by_route.get(route_id)
        if destination is None:
            raise ValueError(f"destination row missing for route {route_id} (destination_id={_get(route, 'destination_id')})")
        dest_config = dict(destination.config_json or {})
        dest_type = str(destination.destination_type or "").strip().upper()
        if dest_type == "AI_PROVIDER_POST":
            if preloaded_ai_provider is not None:
                if not bool(preloaded_ai_provider.enabled):
                    raise ValueError(f"ai provider disabled: {preloaded_ai_provider.id}")
                dest_config["_provider"] = provider_runtime_bundle(preloaded_ai_provider)
                if ai_stream_id is not None:
                    dest_config["_ai_stream_id"] = int(ai_stream_id)
            else:
                dest_config = resolve_ai_provider_destination_config(db, dest_config)
        runtime_routes.append(
            {
                "id": route_id,
                "enabled": bool(route.enabled),
                "failure_policy": route.failure_policy,
                "formatter_config_json": route.formatter_config_json or {},
                "rate_limit_json": route.rate_limit_json or {},
                "retry_count": _get(route, "retry_count", 2),
                "backoff_seconds": _get(route, "backoff_seconds", 1.0),
                "destination": {
                    "id": int(destination.id),
                    "destination_type": destination.destination_type,
                    "config": dest_config,
                    "enabled": bool(destination.enabled),
                    "rate_limit_json": destination.rate_limit_json or {},
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
        "connector_id": int(stream.connector_id),
        "enabled": bool(stream.enabled),
        "status": stream.status,
        "polling_interval": int(stream.polling_interval or 60),
        "source_id": int(stream.source_id),
        "source_type": str(source.source_type),
        "stream_config": coerce_stream_body_fields_to_json_objects(_extract_stream_config(stream)),
        "event_array_path": mapping.event_array_path if mapping is not None else None,
        "event_root_path": mapping.event_root_path if mapping is not None else None,
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
        persist_checkpoint=True,
        replay_start=None,
        replay_end=None,
        dry_run=False,
    )
