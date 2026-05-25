"""Orchestrate Template Draft inference from request + sample payload."""

from __future__ import annotations

import copy
import json
from typing import Any

from app.parsers.event_extractor import MappingError, extract_events
from app.runtime.errors import ParserError
from app.templates.inference.arrays import detect_event_array_candidates, pick_default_array_path
from app.templates.inference.enrichment import detect_enrichment_candidates
from app.templates.inference.fields import (
    detect_checkpoint_candidates,
    detect_severity_candidates,
    detect_tenant_candidates,
    detect_timestamp_candidates,
)
from app.templates.inference.mapping import detect_mapping_candidates


def _path_for_extract(jsonpath_style: str | None) -> str | None:
    if not jsonpath_style or not str(jsonpath_style).strip():
        return None
    p = str(jsonpath_style).strip()
    if p == "$":
        return None
    return p


def _extract_sample_event(parsed: Any, event_array_path: str | None) -> Any | None:
    try:
        ev_path = _path_for_extract(event_array_path)
        events = extract_events(parsed, ev_path)
        if events:
            return copy.deepcopy(events[0])
    except (MappingError, ParserError, TypeError, ValueError):
        pass
    try:
        events = extract_events(parsed, None)
        if events:
            return copy.deepcopy(events[0])
    except (MappingError, ParserError, TypeError, ValueError):
        pass
    return None


def _apply_mapping_preview(sample_event: dict[str, Any], mapping_candidates: list[dict[str, Any]]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for row in mapping_candidates:
        out_key = str(row.get("output_field") or "").strip()
        src = str(row.get("source_json_path") or "").strip()
        if not out_key or not src:
            continue
        path = src[2:] if src.startswith("$.") else src
        cur: Any = sample_event
        for part in path.split("."):
            if not part or not isinstance(cur, dict):
                cur = None
                break
            cur = cur.get(part)
        if cur is not None:
            normalized[out_key] = cur
    return normalized


def run_sample_inference(
    sample_payload: Any,
    *,
    event_array_hint: str | None = None,
    vendor: str | None = None,
    product: str | None = None,
    source_type: str = "HTTP_API_POLLING",
    approved_event_array_path: str | None = None,
    approved_mapping_candidates: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Return inference bundle with confidence and explanations (no persistence)."""

    parsed = sample_payload
    if isinstance(sample_payload, str):
        try:
            parsed = json.loads(sample_payload)
        except json.JSONDecodeError:
            parsed = None

    arrays = detect_event_array_candidates(parsed)
    default_path = approved_event_array_path or pick_default_array_path(arrays, event_array_hint)
    sample_event = _extract_sample_event(parsed, default_path)

    mapping_rows = approved_mapping_candidates or detect_mapping_candidates(sample_event)
    enrichment_rows = detect_enrichment_candidates(vendor=vendor, product=product, source_type=source_type)

    checkpoint_rows = detect_checkpoint_candidates(parsed, sample_event)
    checkpoint_rec = checkpoint_rows[0] if checkpoint_rows else None

    normalized_preview: dict[str, Any] | None = None
    if isinstance(sample_event, dict) and mapping_rows:
        normalized_preview = _apply_mapping_preview(sample_event, mapping_rows)

    return {
        "event_array_path": default_path,
        "event_array_candidates": arrays,
        "timestamp_candidates": detect_timestamp_candidates(sample_event, parsed),
        "checkpoint_candidates": checkpoint_rows,
        "checkpoint_recommendation": checkpoint_rec,
        "severity_candidates": detect_severity_candidates(sample_event),
        "tenant_candidates": detect_tenant_candidates(sample_event),
        "mapping_candidates": mapping_rows,
        "enrichment_candidates": enrichment_rows,
        "sample_event": sample_event,
        "normalized_event_preview": normalized_preview,
    }
