"""Runtime control: stream start/stop; delivery_logs retention cleanup."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.destinations.models import Destination
from app.connectors.models import Connector
from app.enrichments.models import Enrichment
from app.logs.models import DeliveryLog
from app.mappings.models import Mapping
from app.routes.models import Route
from app.sources.models import Source
from app.runtime.schemas import (
    ConnectorUISaveRequest,
    ConnectorUISaveResponse,
    DestinationUISaveRequest,
    DestinationUISaveResponse,
    MappingUISaveRequest,
    MappingUISaveResponse,
    RouteUISaveRequest,
    RouteUISaveResponse,
    RuntimeDestinationRateLimitSaveRequest,
    RuntimeDestinationRateLimitSaveResponse,
    RuntimeEnrichmentSaveRequest,
    RuntimeEnrichmentSaveResponse,
    RuntimeLogsCleanupResponse,
    RuntimeMappingSaveRequest,
    RuntimeMappingSaveResponse,
    RuntimeRouteEnabledSaveRequest,
    RuntimeRouteEnabledSaveResponse,
    RuntimeRouteFailurePolicySaveRequest,
    RuntimeRouteFailurePolicySaveResponse,
    RuntimeRouteFormatterSaveRequest,
    RuntimeRouteFormatterSaveResponse,
    RuntimeRouteRateLimitSaveRequest,
    RuntimeRouteRateLimitSaveResponse,
    RuntimeStreamControlResponse,
    RuntimeStreamRateLimitSaveRequest,
    RuntimeStreamRateLimitSaveResponse,
    SourceUISaveRequest,
    SourceUISaveResponse,
    StreamUISaveRequest,
    StreamUISaveResponse,
)
from app.streams.models import Stream


# API tokens (Mapping UI) ↔ values persisted for StreamRunner / enrichment_engine.
_ENRICHMENT_OVERRIDE_API_TO_DB = {"fill_missing": "KEEP_EXISTING", "override": "OVERRIDE"}
_ENRICHMENT_OVERRIDE_DB_TO_API = {"KEEP_EXISTING": "fill_missing", "OVERRIDE": "override"}


class StreamNotFoundError(Exception):
    """Raised when stream_id is missing; router maps to HTTP 404 STREAM_NOT_FOUND."""

    def __init__(self, stream_id: int) -> None:
        super().__init__(stream_id)
        self.stream_id = stream_id


class RouteNotFoundError(Exception):
    """Raised when route_id is missing; router maps to HTTP 404 ROUTE_NOT_FOUND."""

    def __init__(self, route_id: int) -> None:
        super().__init__(route_id)
        self.route_id = route_id


class DestinationNotFoundError(Exception):
    """Raised when destination_id is missing; router maps to HTTP 404 DESTINATION_NOT_FOUND."""

    def __init__(self, destination_id: int) -> None:
        super().__init__(destination_id)
        self.destination_id = destination_id


class SourceNotFoundError(Exception):
    """Raised when source_id is missing; router maps to HTTP 404 SOURCE_NOT_FOUND."""

    def __init__(self, source_id: int) -> None:
        super().__init__(source_id)
        self.source_id = source_id


class ConnectorNotFoundError(Exception):
    """Raised when connector_id is missing; router maps to HTTP 404 CONNECTOR_NOT_FOUND."""

    def __init__(self, connector_id: int) -> None:
        super().__init__(connector_id)
        self.connector_id = connector_id


def start_stream(db: Session, stream_id: int) -> RuntimeStreamControlResponse:
    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if stream is None:
        raise StreamNotFoundError(stream_id)
    stream.enabled = True
    stream.status = "RUNNING"
    db.commit()
    db.refresh(stream)
    return RuntimeStreamControlResponse(
        stream_id=int(stream.id),
        enabled=bool(stream.enabled),
        status=str(stream.status),
        action="start",
        message="Stream is enabled and status set to RUNNING.",
    )


def stop_stream(db: Session, stream_id: int) -> RuntimeStreamControlResponse:
    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if stream is None:
        raise StreamNotFoundError(stream_id)
    stream.enabled = False
    stream.status = "STOPPED"
    db.commit()
    db.refresh(stream)
    return RuntimeStreamControlResponse(
        stream_id=int(stream.id),
        enabled=bool(stream.enabled),
        status=str(stream.status),
        action="stop",
        message="Stream is disabled and status set to STOPPED.",
    )


def save_runtime_stream_mapping(
    db: Session,
    stream_id: int,
    payload: RuntimeMappingSaveRequest,
) -> RuntimeMappingSaveResponse:
    """Create or update the single Mapping row for stream_id (one commit; Mapping columns only)."""

    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if stream is None:
        raise StreamNotFoundError(stream_id)

    mapping = db.query(Mapping).filter(Mapping.stream_id == stream_id).first()
    fields = dict(payload.field_mappings)

    if mapping is None:
        mapping = Mapping(
            stream_id=stream_id,
            event_array_path=payload.event_array_path,
            field_mappings_json=fields,
        )
        db.add(mapping)
        message = "Mapping configuration created for stream."
    else:
        mapping.event_array_path = payload.event_array_path
        mapping.field_mappings_json = fields
        message = "Mapping configuration updated for stream."

    db.commit()
    db.refresh(mapping)

    fm = mapping.field_mappings_json or {}
    return RuntimeMappingSaveResponse(
        stream_id=stream_id,
        mapping_id=int(mapping.id),
        event_array_path=mapping.event_array_path,
        field_count=len(fm),
        message=message,
    )


def save_runtime_mapping_ui_config(
    db: Session,
    stream_id: int,
    payload: MappingUISaveRequest,
) -> MappingUISaveResponse:
    """Save Mapping UI bundle (mapping/enrichment/route formatter) with one commit."""

    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if stream is None:
        raise StreamNotFoundError(stream_id)

    mapping_saved = False
    enrichment_saved = False
    route_formatter_route_ids: list[int] = []

    if payload.mapping is not None:
        mapping = db.query(Mapping).filter(Mapping.stream_id == stream_id).first()
        fields = dict(payload.mapping.field_mappings)
        if mapping is None:
            mapping = Mapping(
                stream_id=stream_id,
                event_array_path=payload.mapping.event_array_path,
                field_mappings_json=fields,
                raw_payload_mode=payload.mapping.raw_payload_mode,
            )
            db.add(mapping)
        else:
            mapping.event_array_path = payload.mapping.event_array_path
            mapping.field_mappings_json = fields
            mapping.raw_payload_mode = payload.mapping.raw_payload_mode
        mapping_saved = True

    if payload.enrichment is not None:
        fields = dict(payload.enrichment.enrichment)
        enrichment = db.query(Enrichment).filter(Enrichment.stream_id == stream_id).first()
        if enrichment is None:
            enrichment = Enrichment(
                stream_id=stream_id,
                enrichment_json=fields,
                override_policy=payload.enrichment.override_policy,
                enabled=payload.enrichment.enabled,
            )
            db.add(enrichment)
        else:
            enrichment.enrichment_json = fields
            enrichment.override_policy = payload.enrichment.override_policy
            enrichment.enabled = payload.enrichment.enabled
        enrichment_saved = True

    for rf in payload.route_formatters:
        route = db.query(Route).filter(Route.id == rf.route_id).first()
        if route is None or int(route.stream_id) != stream_id:
            raise RouteNotFoundError(rf.route_id)
        route.formatter_config_json = dict(rf.formatter_config)
        route_formatter_route_ids.append(int(route.id))

    db.commit()

    return MappingUISaveResponse(
        stream_id=stream_id,
        mapping_saved=mapping_saved,
        enrichment_saved=enrichment_saved,
        route_formatter_saved_count=len(route_formatter_route_ids),
        route_formatter_route_ids=route_formatter_route_ids,
        message="Mapping UI configuration saved successfully",
    )


def save_runtime_stream_enrichment(
    db: Session,
    stream_id: int,
    payload: RuntimeEnrichmentSaveRequest,
) -> RuntimeEnrichmentSaveResponse:
    """Create or update the single Enrichment row for stream_id (one commit; Enrichment columns only)."""

    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if stream is None:
        raise StreamNotFoundError(stream_id)

    db_policy = _ENRICHMENT_OVERRIDE_API_TO_DB[payload.override_policy]
    fields = dict(payload.enrichment)

    enrichment = db.query(Enrichment).filter(Enrichment.stream_id == stream_id).first()
    if enrichment is None:
        enrichment = Enrichment(
            stream_id=stream_id,
            enrichment_json=fields,
            override_policy=db_policy,
            enabled=payload.enabled,
        )
        db.add(enrichment)
        message = "Enrichment configuration created for stream."
    else:
        enrichment.enrichment_json = fields
        enrichment.override_policy = db_policy
        enrichment.enabled = payload.enabled
        message = "Enrichment configuration updated for stream."

    db.commit()
    db.refresh(enrichment)

    ej = enrichment.enrichment_json or {}
    api_policy = _ENRICHMENT_OVERRIDE_DB_TO_API.get(
        str(enrichment.override_policy or ""),
        str(enrichment.override_policy or ""),
    )
    return RuntimeEnrichmentSaveResponse(
        stream_id=stream_id,
        enrichment_id=int(enrichment.id),
        field_count=len(ej),
        override_policy=api_policy,
        enabled=bool(enrichment.enabled),
        message=message,
    )


def save_runtime_route_formatter_config(
    db: Session,
    route_id: int,
    payload: RuntimeRouteFormatterSaveRequest,
) -> RuntimeRouteFormatterSaveResponse:
    """Update Route.formatter_config_json only (one commit; Route row only)."""

    route = db.query(Route).filter(Route.id == route_id).first()
    if route is None:
        raise RouteNotFoundError(route_id)

    route.formatter_config_json = dict(payload.formatter_config)
    db.commit()
    db.refresh(route)

    formatter_config = dict(route.formatter_config_json or {})
    return RuntimeRouteFormatterSaveResponse(
        route_id=int(route.id),
        stream_id=int(route.stream_id),
        destination_id=int(route.destination_id),
        formatter_config=formatter_config,
        field_count=len(formatter_config),
        message="Route formatter configuration saved.",
    )


def save_runtime_route_ui_config(
    db: Session,
    route_id: int,
    payload: RouteUISaveRequest,
) -> RouteUISaveResponse:
    """Save Route UI settings (route fields + destination.enabled) in one commit."""

    route = db.query(Route).filter(Route.id == route_id).first()
    if route is None:
        raise RouteNotFoundError(route_id)

    destination = db.query(Destination).filter(Destination.id == route.destination_id).first()
    if destination is None:
        raise RouteNotFoundError(route_id)

    if payload.route_enabled is not None:
        route.enabled = bool(payload.route_enabled)
    if payload.route_formatter_config is not None:
        route.formatter_config_json = dict(payload.route_formatter_config)
    if payload.route_rate_limit is not None:
        route.rate_limit_json = dict(payload.route_rate_limit)
    if payload.failure_policy is not None:
        route.failure_policy = payload.failure_policy
    if payload.destination_enabled is not None:
        destination.enabled = bool(payload.destination_enabled)

    db.commit()

    return RouteUISaveResponse(
        route_id=int(route.id),
        destination_id=int(route.destination_id),
        route_enabled=bool(route.enabled),
        destination_enabled=bool(destination.enabled),
        failure_policy=str(route.failure_policy),
        formatter_config=dict(route.formatter_config_json or {}),
        route_rate_limit=dict(route.rate_limit_json or {}),
        message="Route UI configuration saved successfully",
    )


def save_runtime_destination_ui_config(
    db: Session,
    destination_id: int,
    payload: DestinationUISaveRequest,
) -> DestinationUISaveResponse:
    """Save Destination UI settings (name/enabled/config/rate-limit) in one commit."""

    destination = db.query(Destination).filter(Destination.id == destination_id).first()
    if destination is None:
        raise DestinationNotFoundError(destination_id)

    destination.name = payload.name
    destination.enabled = bool(payload.enabled)
    destination.config_json = dict(payload.config_json)
    destination.rate_limit_json = dict(payload.rate_limit_json)

    db.commit()

    return DestinationUISaveResponse(
        destination_id=int(destination.id),
        name=str(destination.name),
        enabled=bool(destination.enabled),
        config_json=dict(destination.config_json or {}),
        rate_limit_json=dict(destination.rate_limit_json or {}),
        message="Destination UI configuration saved successfully",
    )


def save_runtime_stream_ui_config(
    db: Session,
    stream_id: int,
    payload: StreamUISaveRequest,
) -> StreamUISaveResponse:
    """Save Stream UI settings (name/enabled/polling/config/rate-limit) in one commit."""

    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if stream is None:
        raise StreamNotFoundError(stream_id)

    stream.name = payload.name
    stream.enabled = bool(payload.enabled)
    stream.polling_interval = int(payload.polling_interval)
    stream.config_json = dict(payload.config_json)
    stream.rate_limit_json = dict(payload.rate_limit_json)

    db.commit()

    return StreamUISaveResponse(
        stream_id=int(stream.id),
        name=str(stream.name),
        enabled=bool(stream.enabled),
        polling_interval=int(stream.polling_interval),
        config_json=dict(stream.config_json or {}),
        rate_limit_json=dict(stream.rate_limit_json or {}),
        message="Stream UI configuration saved successfully",
    )


def save_runtime_source_ui_config(
    db: Session,
    source_id: int,
    payload: SourceUISaveRequest,
) -> SourceUISaveResponse:
    """Save Source UI settings (enabled/config/auth) in one commit."""

    source = db.query(Source).filter(Source.id == source_id).first()
    if source is None:
        raise SourceNotFoundError(source_id)

    source.enabled = bool(payload.enabled)
    source.config_json = dict(payload.config_json)
    source.auth_json = dict(payload.auth_json)

    db.commit()

    return SourceUISaveResponse(
        source_id=int(source.id),
        enabled=bool(source.enabled),
        config_json=dict(source.config_json or {}),
        auth_json=dict(source.auth_json or {}),
        message="Source UI configuration saved successfully",
    )


def save_runtime_connector_ui_config(
    db: Session,
    connector_id: int,
    payload: ConnectorUISaveRequest,
) -> ConnectorUISaveResponse:
    """Save Connector UI settings (name/description/status) in one commit."""

    connector = db.query(Connector).filter(Connector.id == connector_id).first()
    if connector is None:
        raise ConnectorNotFoundError(connector_id)

    connector.name = payload.name
    connector.description = payload.description
    connector.status = payload.status

    db.commit()

    return ConnectorUISaveResponse(
        connector_id=int(connector.id),
        name=str(connector.name),
        description=connector.description,
        status=str(connector.status),
        message="Connector UI configuration saved successfully",
    )


def save_runtime_route_failure_policy(
    db: Session,
    route_id: int,
    payload: RuntimeRouteFailurePolicySaveRequest,
) -> RuntimeRouteFailurePolicySaveResponse:
    """Update Route.failure_policy only (one commit; Route row only)."""

    route = db.query(Route).filter(Route.id == route_id).first()
    if route is None:
        raise RouteNotFoundError(route_id)

    route.failure_policy = payload.failure_policy
    db.commit()
    db.refresh(route)

    return RuntimeRouteFailurePolicySaveResponse(
        route_id=int(route.id),
        stream_id=int(route.stream_id),
        destination_id=int(route.destination_id),
        failure_policy=str(route.failure_policy),
        message="Route failure policy saved successfully",
    )


def save_runtime_route_enabled_state(
    db: Session,
    route_id: int,
    payload: RuntimeRouteEnabledSaveRequest,
) -> RuntimeRouteEnabledSaveResponse:
    """Update Route.enabled only (one commit; Route row only)."""

    route = db.query(Route).filter(Route.id == route_id).first()
    if route is None:
        raise RouteNotFoundError(route_id)

    route.enabled = bool(payload.enabled)
    db.commit()
    db.refresh(route)

    return RuntimeRouteEnabledSaveResponse(
        route_id=int(route.id),
        stream_id=int(route.stream_id),
        destination_id=int(route.destination_id),
        enabled=bool(route.enabled),
        message="Route enabled state saved successfully",
    )


def save_runtime_route_rate_limit(
    db: Session,
    route_id: int,
    payload: RuntimeRouteRateLimitSaveRequest,
) -> RuntimeRouteRateLimitSaveResponse:
    """Update Route.rate_limit_json only (one commit; Route row only)."""

    route = db.query(Route).filter(Route.id == route_id).first()
    if route is None:
        raise RouteNotFoundError(route_id)

    route.rate_limit_json = dict(payload.rate_limit)
    db.commit()
    db.refresh(route)

    rate_limit = dict(route.rate_limit_json or {})
    return RuntimeRouteRateLimitSaveResponse(
        route_id=int(route.id),
        stream_id=int(route.stream_id),
        destination_id=int(route.destination_id),
        rate_limit=rate_limit,
        field_count=len(rate_limit),
        message="Route rate limit configuration saved.",
    )


def save_runtime_stream_rate_limit(
    db: Session,
    stream_id: int,
    payload: RuntimeStreamRateLimitSaveRequest,
) -> RuntimeStreamRateLimitSaveResponse:
    """Update Stream.rate_limit_json only (one commit; Stream row only)."""

    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if stream is None:
        raise StreamNotFoundError(stream_id)

    stream.rate_limit_json = dict(payload.rate_limit)
    db.commit()
    db.refresh(stream)

    rate_limit = dict(stream.rate_limit_json or {})
    return RuntimeStreamRateLimitSaveResponse(
        stream_id=int(stream.id),
        connector_id=int(stream.connector_id),
        source_id=int(stream.source_id),
        rate_limit=rate_limit,
        field_count=len(rate_limit),
        message="Stream source rate limit saved successfully",
    )


def save_runtime_destination_rate_limit(
    db: Session,
    destination_id: int,
    payload: RuntimeDestinationRateLimitSaveRequest,
) -> RuntimeDestinationRateLimitSaveResponse:
    """Update Destination.rate_limit_json only (one commit; Destination row only)."""

    destination = db.query(Destination).filter(Destination.id == destination_id).first()
    if destination is None:
        raise DestinationNotFoundError(destination_id)

    destination.rate_limit_json = dict(payload.rate_limit)
    db.commit()
    db.refresh(destination)

    rate_limit = dict(destination.rate_limit_json or {})
    return RuntimeDestinationRateLimitSaveResponse(
        destination_id=int(destination.id),
        destination_type=str(destination.destination_type),
        rate_limit=rate_limit,
        field_count=len(rate_limit),
        message="Destination rate limit saved successfully",
    )


def cleanup_delivery_logs(
    db: Session,
    *,
    older_than_days: int,
    dry_run: bool,
) -> RuntimeLogsCleanupResponse:
    """Delete delivery_logs with created_at before cutoff, or count only when dry_run."""

    cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    flt = DeliveryLog.created_at < cutoff
    matched_count = db.query(DeliveryLog).filter(flt).count()
    deleted_count = 0
    if dry_run:
        message = "Dry run: matched rows were counted; nothing deleted."
    else:
        deleted_count = db.query(DeliveryLog).filter(flt).delete(synchronize_session=False)
        db.commit()
        message = f"Deleted {deleted_count} delivery_logs row(s) with created_at before cutoff."
    return RuntimeLogsCleanupResponse(
        older_than_days=older_than_days,
        dry_run=dry_run,
        cutoff=cutoff,
        matched_count=matched_count,
        deleted_count=deleted_count,
        message=message,
    )
