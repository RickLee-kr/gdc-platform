"""Unit tests for resolve_route_transform_config."""

from __future__ import annotations

from app.runners.route_transform_config import resolve_route_transform_config


def test_resolve_route_transform_config_route_row_counts_as_present() -> None:
    cfg = resolve_route_transform_config(
        route_mapping={"field_mappings_json": {}},
        route_enrichment=None,
        stream_mapping={"field_mappings_json": {"stream_field": "$.id"}},
        stream_enrichment=None,
        stream_field_mappings={"stream_field": "$.id"},
    )
    assert cfg.mapping_source == "route"
    assert cfg.field_mappings == {}
