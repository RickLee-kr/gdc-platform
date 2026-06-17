"""M13.1/M13.2 — Build RouteRuntimeContext and SharedBatchContext from loaded stream runtime."""

from __future__ import annotations

import time
from typing import Any

from app.runners.route_context import (
    RouteEffectiveConfig,
    RouteProcessingMetrics,
    RouteRuntimeContext,
    SharedBatchContext,
    dual_read,
)
from app.route_protection.resolver import resolve_route_protection_config
from app.route_classification.resolver import resolve_route_classification_config
from app.route_policy.resolver import resolve_route_policy_config
from app.runners.route_transform_config import resolve_route_transform_config


def _get(data: Any, key: str, default: Any = None) -> Any:
    if isinstance(data, dict):
        return data.get(key, default)
    return getattr(data, key, default)


def build_shared_batch_context(
    *,
    stream_id: int,
    batch_id: str,
    runtime_stream: Any,
    extracted_events: list[dict[str, Any]],
    shared_runtime_data: dict[str, Any] | None = None,
    schema_observation: dict[str, Any] | None = None,
    sensitive_detection_result: Any = None,
    schema_drift_policy_result: Any = None,
    checkpoint_cursor_before: dict[str, Any] | None = None,
    fetch_metadata: dict[str, Any] | None = None,
    events: list[dict[str, Any]] | None = None,
) -> SharedBatchContext:
    """Assemble shared batch context after shared phase (extract/observe/detect)."""

    stream_config = dict(_get(runtime_stream, "stream_config", {}) or {})
    event_root = _get(runtime_stream, "event_root_path") or stream_config.get("event_root_path")
    union_schema = stream_config.get("union_schema")
    if not isinstance(union_schema, list):
        union_schema = []
    observed_schema = stream_config.get("observed_schema")
    if not isinstance(observed_schema, dict):
        observed_schema = {}

    observation = dict(schema_observation or {})
    if "observed_schema" not in observation and observed_schema:
        observation.setdefault("observed_schema", dict(observed_schema))

    raw_events = extracted_events if events is None else events

    return SharedBatchContext(
        stream_id=int(stream_id),
        batch_id=str(batch_id),
        event_root=str(event_root) if event_root else None,
        union_schema=list(union_schema),
        extracted_events=list(raw_events),
        schema_observation=observation,
        sensitive_detection_result=sensitive_detection_result,
        schema_drift_policy_result=schema_drift_policy_result,
        checkpoint_cursor_before=dict(checkpoint_cursor_before) if checkpoint_cursor_before else None,
        shared_runtime_data=dict(shared_runtime_data or {}),
        fetch_metadata=dict(fetch_metadata) if fetch_metadata else None,
    )


def build_route_runtime_contexts(runtime_stream: Any) -> tuple[list[RouteRuntimeContext], RouteProcessingMetrics]:
    """Load route information and build RouteRuntimeContext list with dual-read transform config."""

    started = time.monotonic()
    stream_id = int(_get(runtime_stream, "id"))
    stream_config = dict(_get(runtime_stream, "stream_config", {}) or {})
    stream_metadata = stream_config.get("metadata")
    if not isinstance(stream_metadata, dict):
        stream_metadata = {}

    stream_field_mappings = dict(_get(runtime_stream, "field_mappings", {}) or {})
    stream_enrichment_json = dict(_get(runtime_stream, "enrichment", {}) or {})
    stream_override_policy = str(_get(runtime_stream, "override_policy", "KEEP_EXISTING") or "KEEP_EXISTING")
    stream_mapping_row = _get(runtime_stream, "mapping_row")
    stream_enrichment_row = _get(runtime_stream, "enrichment_row")
    stream_protection_rules = list(_get(runtime_stream, "stream_protection_rules", []) or [])
    stream_classification_rules = list(_get(runtime_stream, "stream_classification_rules", []) or [])
    stream_policy_rules = list(_get(runtime_stream, "stream_policy_rules", []) or [])
    route_overrides = list(_get(runtime_stream, "route_overrides", []) or [])

    contexts: list[RouteRuntimeContext] = []
    fallback_count = 0
    for route in list(_get(runtime_stream, "routes", []) or []):
        route_id = int(_get(route, "id"))
        destination = dict(_get(route, "destination", {}) or {})
        destination_id = int(_get(destination, "id", 0))
        route_type = str(_get(destination, "destination_type", "") or "")
        dest_name = str(_get(destination, "name", "") or "")
        route_name = str(
            dual_read(
                _get(route, "name"),
                dest_name or f"route-{route_id}",
            )
        )
        formatter_raw = _get(route, "formatter_config_json")
        formatter = dict(formatter_raw) if isinstance(formatter_raw, dict) else {}
        delivery_policy = str(_get(route, "failure_policy", "LOG_AND_CONTINUE") or "LOG_AND_CONTINUE")
        rate_limit_raw = _get(route, "rate_limit_json")
        rate_limit = dict(rate_limit_raw) if isinstance(rate_limit_raw, dict) else {}
        route_metadata_raw = _get(route, "metadata")
        route_metadata = dict(route_metadata_raw) if isinstance(route_metadata_raw, dict) else {}
        metadata = dict(dual_read(route_metadata, stream_metadata) or {})

        route_mapping_row = _get(route, "route_mapping_row")
        route_enrichment_row = _get(route, "route_enrichment_row")
        route_protection_rules = list(_get(route, "route_protection_rules", []) or [])
        route_classification_rules = list(_get(route, "route_classification_rules", []) or [])
        route_policy_rules = list(_get(route, "route_policy_rules", []) or [])
        metadata["_route_protection_rules"] = route_protection_rules
        metadata["_route_classification_rules"] = route_classification_rules
        metadata["_route_policy_rules"] = route_policy_rules
        transform_config = resolve_route_transform_config(
            route_mapping=route_mapping_row,
            route_enrichment=route_enrichment_row,
            stream_mapping=stream_mapping_row,
            stream_enrichment=stream_enrichment_row,
            stream_field_mappings=stream_field_mappings,
            stream_enrichment_json=stream_enrichment_json,
            stream_override_policy=stream_override_policy,
        )
        if transform_config.fallback_used:
            fallback_count += 1

        protection_config = resolve_route_protection_config(
            route_id=route_id,
            stream_id=stream_id,
            route_protection_rules=route_protection_rules,
            stream_protection_rules=stream_protection_rules,
            route_overrides=route_overrides,
        )

        classification_config = resolve_route_classification_config(
            route_id=route_id,
            stream_id=stream_id,
            route_classification_rules=route_classification_rules,
            stream_classification_rules=stream_classification_rules,
            route_overrides=route_overrides,
        )

        policy_config = resolve_route_policy_config(
            route_id=route_id,
            stream_id=stream_id,
            route_policy_rules=route_policy_rules,
            stream_policy_rules=stream_policy_rules,
            route_overrides=route_overrides,
        )

        contexts.append(
            RouteRuntimeContext(
                route_id=route_id,
                stream_id=stream_id,
                destination_id=destination_id,
                route_name=route_name,
                route_type=route_type,
                formatter=formatter,
                delivery_policy=delivery_policy,
                rate_limit=rate_limit,
                metadata=metadata,
                effective_config=RouteEffectiveConfig(
                    transform=transform_config,
                    protection=protection_config,
                    classification=classification_config,
                    policy=policy_config,
                ),
                enabled=bool(_get(route, "enabled", True)),
            )
        )

    build_ms = max(0, int((time.monotonic() - started) * 1000))
    metrics = RouteProcessingMetrics(
        route_count=len(contexts),
        route_context_build_time_ms=build_ms,
        route_transform_fallback_count=fallback_count,
    )
    return contexts, metrics
