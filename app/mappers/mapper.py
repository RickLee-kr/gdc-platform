"""Mapping engine — JSONPath field extraction only (no enrichment, no formatting).

Pipeline position: EventExtractor → **Mapping** → Enrichment → Formatter → Destination.
"""

from __future__ import annotations

from typing import Any

from app.runtime.copy_utils import copy_json_value

from app.mappers.mapping_results import MappingApplyResult, MappingEventError
from app.parsers.event_extractor import extract_events
from app.parsers.jsonpath_parser import compile_jsonpath, extract_one_compiled
from app.runtime.errors import MappingError, ParserError


def apply_mapping(event: dict[str, Any], field_mappings: dict[str, str]) -> dict[str, Any]:
    """Project ``event`` through flat JSONPath expressions onto output keys.

    Each ``field_mappings`` entry maps ``output_field_name → JSONPath string``.
    Missing paths yield ``None`` (via ``extract_one(..., default=None)``).

    Does not mutate ``event``. Does not apply enrichment or formatting.

    Raises:
        MappingError: Non-dict ``event``, or invalid JSONPath in mapping rules.
    """

    if not isinstance(event, dict):
        raise MappingError(f"apply_mapping expects dict event, got {type(event).__name__}")

    if not field_mappings:
        return {}

    compiled = compile_mappings(field_mappings)
    return apply_compiled_mapping(event, compiled)


def apply_mappings(events: list[dict[str, Any]], field_mappings: dict[str, str]) -> list[dict[str, Any]]:
    """Apply :func:`apply_mapping` to each event independently."""

    compiled = compile_mappings(field_mappings)
    return apply_compiled_mappings(events, compiled)


def apply_mappings_with_results(
    events: list[dict[str, Any]],
    field_mappings: dict[str, str] | None,
) -> list[MappingApplyResult]:
    """Batch mapping with per-event structured errors for runtime delivery_logs.

    Thin compatibility wrapper over :func:`apply_mappings` for StreamRunner.
    Simple JSONPath mappings produce no field-level errors; invalid events yield
    structured ``event_error`` entries instead of aborting the whole batch.
    """

    compiled = compile_mappings(field_mappings or {})
    results: list[MappingApplyResult] = []
    for event in events:
        if not isinstance(event, dict):
            results.append(
                MappingApplyResult(
                    mapped_event={},
                    event_error=MappingEventError(
                        error_code="MAPPING_EVENT_INVALID",
                        error_message=(
                            f"apply_mapping expects dict event, got {type(event).__name__}"
                        ),
                    ),
                )
            )
            continue
        results.append(
            MappingApplyResult(
                mapped_event=apply_compiled_mapping(event, compiled),
                field_errors=[],
            )
        )
    return results


def compile_mappings(field_mappings: dict[str, str]) -> dict[str, Any]:
    """Compile mapping JSONPath expressions once for reuse across events."""

    if not field_mappings:
        return {}

    compiled: dict[str, Any] = {}
    for out_field, jsonpath_expr in field_mappings.items():
        try:
            compiled[out_field] = compile_jsonpath(jsonpath_expr)
        except ParserError as exc:
            raise MappingError(
                f"Invalid JSONPath for output field {out_field!r}: {jsonpath_expr!r}"
            ) from exc
    return compiled


def apply_compiled_mapping(event: dict[str, Any], compiled_mappings: dict[str, Any]) -> dict[str, Any]:
    """Apply precompiled JSONPath expressions to a single event."""

    if not isinstance(event, dict):
        raise MappingError(f"apply_compiled_mapping expects dict event, got {type(event).__name__}")

    if not compiled_mappings:
        return {}

    output: dict[str, Any] = {}
    for out_field, compiled_expr in compiled_mappings.items():
        value = extract_one_compiled(compiled_expr, event, default=None)
        output[out_field] = copy_json_value(value)
    return output


def apply_compiled_mappings(
    events: list[dict[str, Any]], compiled_mappings: dict[str, Any]
) -> list[dict[str, Any]]:
    """Apply compiled mappings to all events with one compile step."""

    return [apply_compiled_mapping(event, compiled_mappings) for event in events]


def build_preview(
    raw_response: Any,
    event_array_path: str | None,
    field_mappings: dict[str, str],
    enrichment: dict[str, Any],
    override_policy: str = "KEEP_EXISTING",
    event_root_path: str | None = None,
) -> list[dict[str, Any]]:
    """Run extract → map → enrich for UI preview (no I/O, no checkpoint).

    Order:
        ``raw_response`` → :func:`extract_events` → :func:`apply_mappings`
        → :func:`apply_enrichments`.

    This helper does not send data or touch persistence.
    """

    # Local import keeps enrichment module free of mapper imports at load time.
    from app.enrichers.enrichment_engine import apply_enrichments

    extracted = extract_events(raw_response, event_array_path, event_root_path)
    mapped = apply_mappings(extracted, field_mappings)
    return apply_enrichments(mapped, enrichment, override_policy=override_policy)


class Mapper:
    """Thin façade over mapping functions for dependency injection / tests."""

    def apply_mapping(self, event: dict[str, Any], field_mappings: dict[str, str]) -> dict[str, Any]:
        """Delegate to :func:`apply_mapping`."""

        return apply_mapping(event, field_mappings)

    def apply_mappings(self, events: list[dict[str, Any]], field_mappings: dict[str, str]) -> list[dict[str, Any]]:
        """Delegate to :func:`apply_mappings`."""

        return apply_mappings(events, field_mappings)
