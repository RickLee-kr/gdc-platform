"""M13.2 — dual-read transform configuration resolution."""

from __future__ import annotations

from typing import Any

from app.runners.route_context import RouteTransformConfig, TransformSource


def _row_present(row: Any) -> bool:
    return row is not None


def _mapping_field_mappings(row: Any) -> dict[str, Any]:
    if row is None:
        return {}
    if isinstance(row, dict):
        raw = row.get("field_mappings_json", row.get("field_mappings", {}))
    else:
        raw = getattr(row, "field_mappings_json", None)
    return dict(raw or {})


def _enrichment_json(row: Any) -> dict[str, Any]:
    if row is None:
        return {}
    if isinstance(row, dict):
        raw = row.get("enrichment_json", row.get("enrichment", {}))
    else:
        raw = getattr(row, "enrichment_json", None)
    return dict(raw or {})


def _override_policy(row: Any, *, stream_default: str) -> str:
    if row is None:
        return stream_default
    if isinstance(row, dict):
        policy = row.get("override_policy")
    else:
        policy = getattr(row, "override_policy", None)
    return str(policy or stream_default)


def resolve_route_transform_config(
    *,
    route_mapping: Any | None,
    route_enrichment: Any | None,
    stream_mapping: Any | None,
    stream_enrichment: Any | None,
    stream_field_mappings: dict[str, Any] | None = None,
    stream_enrichment_json: dict[str, Any] | None = None,
    stream_override_policy: str = "KEEP_EXISTING",
) -> RouteTransformConfig:
    """Resolve effective mapping + enrichment for a route (route row first, stream fallback)."""

    mapping_source: TransformSource = "route" if _row_present(route_mapping) else "stream"
    enrichment_source: TransformSource = "route" if _row_present(route_enrichment) else "stream"

    effective_mapping_row = route_mapping if _row_present(route_mapping) else stream_mapping
    effective_enrichment_row = route_enrichment if _row_present(route_enrichment) else stream_enrichment

    field_mappings = _mapping_field_mappings(effective_mapping_row)
    if mapping_source == "stream" and not field_mappings and stream_field_mappings:
        field_mappings = dict(stream_field_mappings)

    enrichment = _enrichment_json(effective_enrichment_row)
    if enrichment_source == "stream" and not enrichment and stream_enrichment_json:
        enrichment = dict(stream_enrichment_json)

    override_policy = _override_policy(
        effective_enrichment_row,
        stream_default=stream_override_policy,
    )

    return RouteTransformConfig(
        field_mappings=field_mappings,
        enrichment=enrichment,
        override_policy=override_policy,
        mapping_source=mapping_source,
        enrichment_source=enrichment_source,
    )
