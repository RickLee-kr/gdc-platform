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
from app.mappers.mapper import apply_compiled_mappings, compile_mappings
from app.parsers.event_extractor import extract_events
from app.pollers.http_poller import HttpPoller
from app.routes.models import Route
from app.runtime.errors import EnrichmentError, MappingError, ParserError, SourceFetchError
from app.runtime.schemas import (
    DeliveryFormatDraftPreviewRequest,
    DeliveryFormatDraftPreviewResponse,
    E2EDraftPreviewRequest,
    E2EDraftPreviewResponse,
    FormatPreviewRequest,
    FormatPreviewResponse,
    FinalEventDraftPreviewRequest,
    FinalEventDraftPreviewResponse,
    HttpApiTestRequest,
    HttpApiTestResponse,
    MappingDraftPreviewMissingFieldItem,
    MappingDraftPreviewRequest,
    MappingDraftPreviewResponse,
    MappingJsonPathItem,
    MappingJsonPathsRequest,
    MappingJsonPathsResponse,
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


def _json_value_type(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return "unknown"


def extract_mapping_json_paths(payload: MappingJsonPathsRequest) -> MappingJsonPathsResponse:
    max_depth = payload.max_depth if payload.max_depth is not None else 8
    max_paths = payload.max_paths if payload.max_paths is not None else 500
    out: list[MappingJsonPathItem] = []

    def _walk(value: Any, path: str, depth: int, under_array: bool) -> None:
        if depth > max_depth:
            return
        if isinstance(value, dict):
            if not payload.scalars_only:
                out.append(
                    MappingJsonPathItem(
                        path=path,
                        value_type="object",
                        sample_value=None,
                        is_array=under_array,
                        depth=depth,
                    )
                )
            for k, v in value.items():
                _walk(v, f"{path}.{k}", depth + 1, under_array)
            return

        if isinstance(value, list):
            if not payload.scalars_only:
                out.append(
                    MappingJsonPathItem(
                        path=path,
                        value_type="array",
                        sample_value=None,
                        is_array=under_array,
                        depth=depth,
                    )
                )
            if value:
                _walk(value[0], f"{path}[0]", depth + 1, True)
            return

        out.append(
            MappingJsonPathItem(
                path=path,
                value_type=_json_value_type(value),
                sample_value=value,
                is_array=under_array,
                depth=depth,
            )
        )

    if isinstance(payload.payload, dict):
        for k, v in payload.payload.items():
            _walk(v, f"$.{k}", 1, False)
    elif isinstance(payload.payload, list):
        if payload.payload:
            _walk(payload.payload[0], "$[0]", 1, True)

    total = len(out)
    return MappingJsonPathsResponse(total=total, paths=out[:max_paths])


def _run_mapping_draft_core(
    payload_obj: dict[str, Any] | list[Any],
    event_array_path: str | None,
    field_mappings: dict[str, str],
    max_events: int,
) -> tuple[int, list[dict[str, Any]], list[MappingDraftPreviewMissingFieldItem]]:
    try:
        events = extract_events(payload_obj, event_array_path)
    except (MappingError, ParserError) as exc:
        raise PreviewRequestError(400, {"code": "EVENT_EXTRACTION_FAILED", "message": str(exc)}) from exc

    preview_events = events[:max_events]
    try:
        compiled = compile_mappings(field_mappings)
        mapped_events = apply_compiled_mappings(preview_events, compiled)
    except MappingError as exc:
        raise PreviewRequestError(400, {"code": "MAPPING_FAILED", "message": str(exc)}) from exc

    missing_fields: list[MappingDraftPreviewMissingFieldItem] = []
    for idx, event in enumerate(preview_events):
        for output_field, json_path in field_mappings.items():
            compiled_expr = compiled.get(output_field)
            if compiled_expr is None:
                continue
            if not compiled_expr.find(event):
                missing_fields.append(
                    MappingDraftPreviewMissingFieldItem(
                        output_field=output_field,
                        json_path=json_path,
                        event_index=idx,
                    )
                )

    return len(events), mapped_events, missing_fields


def run_mapping_draft_preview(payload: MappingDraftPreviewRequest) -> MappingDraftPreviewResponse:
    input_count, mapped_events, missing_fields = _run_mapping_draft_core(
        payload.payload,
        payload.event_array_path,
        payload.field_mappings,
        payload.max_events,
    )
    return MappingDraftPreviewResponse(
        input_event_count=input_count,
        preview_event_count=len(mapped_events),
        mapped_events=mapped_events,
        missing_fields=missing_fields,
        message="Mapping draft preview generated successfully",
    )


def run_final_event_draft_preview(payload: FinalEventDraftPreviewRequest) -> FinalEventDraftPreviewResponse:
    input_count, mapped_events, missing_fields = _run_mapping_draft_core(
        payload.payload,
        payload.event_array_path,
        payload.field_mappings,
        payload.max_events,
    )
    try:
        final_events = apply_enrichments(mapped_events, payload.enrichment, payload.override_policy)
    except EnrichmentError as exc:
        raise PreviewRequestError(400, {"code": "ENRICHMENT_FAILED", "message": str(exc)}) from exc

    return FinalEventDraftPreviewResponse(
        input_event_count=input_count,
        preview_event_count=len(mapped_events),
        mapped_events=mapped_events,
        final_events=final_events,
        missing_fields=missing_fields,
        message="Final event draft preview generated successfully",
    )


def run_delivery_format_draft_preview(
    payload: DeliveryFormatDraftPreviewRequest,
) -> DeliveryFormatDraftPreviewResponse:
    preview_events = payload.final_events[: payload.max_events]
    try:
        formatted = run_format_preview(
            FormatPreviewRequest(
                events=preview_events,
                destination_type=payload.destination_type,
                formatter_config=payload.formatter_config,
            )
        )
    except PreviewRequestError as exc:
        detail = exc.detail
        code = detail.get("error_code", "FORMAT_PREVIEW_FAILED")
        raise PreviewRequestError(400, {"code": code, "message": detail.get("message", str(detail))}) from exc

    return DeliveryFormatDraftPreviewResponse(
        input_event_count=len(payload.final_events),
        preview_event_count=len(preview_events),
        destination_type=formatted.destination_type,
        preview_messages=formatted.preview_messages,
        message="Delivery format draft preview generated successfully",
    )


def run_e2e_draft_preview(payload: E2EDraftPreviewRequest) -> E2EDraftPreviewResponse:
    final_preview = run_final_event_draft_preview(
        FinalEventDraftPreviewRequest(
            payload=payload.payload,
            event_array_path=payload.event_array_path,
            field_mappings=payload.field_mappings,
            enrichment=payload.enrichment,
            override_policy=payload.override_policy,
            max_events=payload.max_events,
        )
    )
    formatted_preview = run_delivery_format_draft_preview(
        DeliveryFormatDraftPreviewRequest(
            final_events=final_preview.final_events,
            destination_type=payload.destination_type,
            formatter_config=payload.formatter_config,
            max_events=payload.max_events,
        )
    )
    return E2EDraftPreviewResponse(
        input_event_count=final_preview.input_event_count,
        preview_event_count=final_preview.preview_event_count,
        mapped_events=final_preview.mapped_events,
        final_events=final_preview.final_events,
        preview_messages=formatted_preview.preview_messages,
        missing_fields=final_preview.missing_fields,
        destination_type=formatted_preview.destination_type,
        message="E2E draft preview generated successfully",
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
