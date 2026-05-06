"""Runtime preview and HTTP API test execution (read-only; no StreamRunner/Sender/DB mutations)."""

from __future__ import annotations

from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.destinations.repository import get_destination_by_id
from app.enrichers.enrichment_engine import apply_enrichments
from app.formatters.config_resolver import resolve_formatter_config
from app.formatters.json_formatter import format_webhook_events
from app.formatters.syslog_formatter import format_syslog
from app.mappers.mapper import apply_mappings
from app.parsers.event_extractor import extract_events
from app.pollers.http_poller import HttpPoller
from app.routes.models import Route
from app.runtime.errors import EnrichmentError, MappingError, ParserError, SourceFetchError
from app.runtime.schemas import (
    FormatPreviewRequest,
    FormatPreviewResponse,
    HttpApiTestRequest,
    HttpApiTestResponse,
    MappingPreviewRequest,
    MappingPreviewResponse,
    RouteDeliveryPreviewRequest,
    RouteDeliveryPreviewResponse,
)


class PreviewRequestError(Exception):
    """Maps to HTTPException in router; preserves status_code and detail shape."""

    def __init__(self, status_code: int, detail: dict[str, Any]) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(str(detail))


def run_http_api_test(payload: HttpApiTestRequest) -> HttpApiTestResponse:
    poller = HttpPoller()
    try:
        raw_response = poller.fetch(
            source_config=payload.source_config,
            stream_config=payload.stream_config,
            checkpoint=payload.checkpoint,
        )
        event_array_path = payload.stream_config.get("event_array_path")
        extracted_events = extract_events(raw_response, event_array_path)
    except SourceFetchError as exc:
        detail = str(exc)
        lowered = detail.lower()
        if "timed out" in lowered or "timeout" in lowered:
            code = "HTTP_TIMEOUT"
        elif "connect" in lowered:
            code = "HTTP_CONNECTION_ERROR"
        elif "not valid json" in lowered:
            code = "INVALID_JSON_RESPONSE"
        else:
            code = "HTTP_REQUEST_FAILED"
        raise PreviewRequestError(400, {"code": code, "message": detail}) from exc
    except httpx.TimeoutException as exc:  # pragma: no cover - defensive
        raise PreviewRequestError(400, {"code": "HTTP_TIMEOUT", "message": str(exc)}) from exc
    except httpx.ConnectError as exc:  # pragma: no cover - defensive
        raise PreviewRequestError(400, {"code": "HTTP_CONNECTION_ERROR", "message": str(exc)}) from exc
    except MappingError as exc:
        raise PreviewRequestError(400, {"code": "EVENT_EXTRACTION_FAILED", "message": str(exc)}) from exc

    return HttpApiTestResponse(
        raw_response=raw_response,
        extracted_events=extracted_events,
        event_count=len(extracted_events),
    )


def run_mapping_preview(payload: MappingPreviewRequest) -> MappingPreviewResponse:
    try:
        events = extract_events(payload.raw_response, payload.event_array_path)
    except (MappingError, ParserError) as exc:
        raise PreviewRequestError(400, {"code": "EVENT_EXTRACTION_FAILED", "message": str(exc)}) from exc

    try:
        mapped_events = apply_mappings(events, payload.field_mappings)
    except MappingError as exc:
        raise PreviewRequestError(400, {"code": "MAPPING_FAILED", "message": str(exc)}) from exc

    try:
        preview_events = apply_enrichments(mapped_events, payload.enrichment, payload.override_policy)
    except EnrichmentError as exc:
        raise PreviewRequestError(400, {"code": "ENRICHMENT_FAILED", "message": str(exc)}) from exc

    return MappingPreviewResponse(
        input_event_count=len(events),
        mapped_event_count=len(mapped_events),
        preview_events=preview_events,
    )


def run_format_preview(payload: FormatPreviewRequest) -> FormatPreviewResponse:
    if payload.destination_type not in {"SYSLOG_UDP", "SYSLOG_TCP", "WEBHOOK_POST"}:
        raise PreviewRequestError(
            400,
            {
                "error_code": "UNSUPPORTED_DESTINATION_TYPE",
                "message": f"Unsupported destination_type: {payload.destination_type}",
            },
        )

    formatter_config = payload.formatter_config

    try:
        if payload.destination_type in {"SYSLOG_UDP", "SYSLOG_TCP"}:
            preview_messages: list[Any] = [
                format_syslog(event=event, formatter_config=formatter_config) for event in payload.events
            ]
        else:
            preview_messages = format_webhook_events(payload.events)
    except Exception as exc:
        raise PreviewRequestError(400, {"error_code": "FORMAT_PREVIEW_FAILED", "message": str(exc)}) from exc

    return FormatPreviewResponse(
        destination_type=payload.destination_type,
        message_count=len(preview_messages),
        preview_messages=preview_messages,
    )


def _route_formatter_override(route: Route) -> dict[str, Any] | None:
    raw = route.formatter_config_json if isinstance(route.formatter_config_json, dict) else {}
    return raw if raw else None


def run_route_delivery_preview(
    db: Session,
    payload: RouteDeliveryPreviewRequest,
) -> RouteDeliveryPreviewResponse:
    route = db.query(Route).filter(Route.id == payload.route_id).first()
    if route is None:
        raise PreviewRequestError(
            404,
            {"error_code": "ROUTE_NOT_FOUND", "message": f"route not found: {payload.route_id}"},
        )

    if not bool(route.enabled):
        raise PreviewRequestError(
            400,
            {"error_code": "ROUTE_DISABLED", "message": "route is disabled"},
        )

    destination = get_destination_by_id(db, int(route.destination_id))
    if destination is None:
        raise PreviewRequestError(
            404,
            {
                "error_code": "DESTINATION_NOT_FOUND",
                "message": f"destination not found for route: {payload.route_id}",
            },
        )

    if not bool(destination.enabled):
        raise PreviewRequestError(
            400,
            {"error_code": "DESTINATION_DISABLED", "message": "destination is disabled"},
        )

    destination_config = destination.config_json or {}
    try:
        resolved = resolve_formatter_config(destination_config, _route_formatter_override(route))
    except ValueError as exc:
        raise PreviewRequestError(400, {"error_code": "ROUTE_DELIVERY_PREVIEW_FAILED", "message": str(exc)}) from exc

    destination_type = str(destination.destination_type or "").strip().upper()

    try:
        if destination_type.startswith("SYSLOG"):
            preview_messages: list[Any] = [
                format_syslog(event=event, formatter_config=resolved) for event in payload.events
            ]
        elif destination_type == "WEBHOOK_POST":
            preview_messages = format_webhook_events(payload.events)
        else:
            raise PreviewRequestError(
                400,
                {
                    "error_code": "UNSUPPORTED_DESTINATION_TYPE",
                    "message": f"Unsupported destination_type: {destination_type}",
                },
            )
    except PreviewRequestError:
        raise
    except Exception as exc:
        raise PreviewRequestError(400, {"error_code": "ROUTE_DELIVERY_PREVIEW_FAILED", "message": str(exc)}) from exc

    return RouteDeliveryPreviewResponse(
        route_id=int(route.id),
        destination_id=int(destination.id),
        destination_type=destination_type,
        route_enabled=bool(route.enabled),
        destination_enabled=bool(destination.enabled),
        message_count=len(preview_messages),
        resolved_formatter_config=resolved,
        preview_messages=preview_messages,
    )
