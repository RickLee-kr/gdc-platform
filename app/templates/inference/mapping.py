"""Suggest mapping rows from a sample event (heuristic, operator approval required)."""

from __future__ import annotations

from typing import Any, TypedDict

from app.templates.inference.fields import (
    _ID_KEYS,
    _SEVERITY_KEYS,
    _TENANT_KEYS,
    _TS_KEYS,
    detect_severity_candidates,
    detect_tenant_candidates,
    detect_timestamp_candidates,
)


class MappingCandidate(TypedDict):
    output_field: str
    source_json_path: str
    confidence: float
    reason: str
    sample_value: Any | None


_OUTPUT_ALIASES: list[tuple[str, frozenset[str]]] = [
    ("event_id", _ID_KEYS),
    ("timestamp", _TS_KEYS),
    ("severity", _SEVERITY_KEYS),
    ("tenant_id", _TENANT_KEYS),
    ("message", frozenset({"message", "msg", "description", "detail", "summary", "title", "name"})),
    ("event_type", frozenset({"type", "event_type", "category", "kind", "action"})),
    ("source", frozenset({"source", "source_name", "origin", "hostname", "host", "device"})),
    ("user", frozenset({"user", "username", "user_name", "actor", "principal"})),
]


def _path_for_key(key: str, base: str = "$") -> str:
    return f"{base}.{key}" if base != "$" else f"$.{key}"


def detect_mapping_candidates(sample_event: Any | None) -> list[MappingCandidate]:
    if not isinstance(sample_event, dict):
        return []

    out: list[MappingCandidate] = []
    used_outputs: set[str] = set()

    for output_field, key_hints in _OUTPUT_ALIASES:
        best: MappingCandidate | None = None
        for k, v in sample_event.items():
            lk = k.lower()
            if lk not in key_hints and not any(h in lk for h in key_hints):
                continue
            if output_field in used_outputs:
                break
            path = _path_for_key(k)
            conf = 0.88 if lk in key_hints else 0.72
            cand = MappingCandidate(
                output_field=output_field,
                source_json_path=path,
                confidence=round(conf, 4),
                reason=f"field {k!r} matches common {output_field} naming",
                sample_value=v,
            )
            if best is None or cand["confidence"] > best["confidence"]:
                best = cand
        if best:
            used_outputs.add(output_field)
            out.append(best)

    for ts in detect_timestamp_candidates(sample_event):
        if "timestamp" not in used_outputs:
            out.append(
                MappingCandidate(
                    output_field="timestamp",
                    source_json_path=ts["field_path"],
                    confidence=ts["confidence"],
                    reason=ts["reason"],
                    sample_value=ts["sample_value"],
                )
            )
            used_outputs.add("timestamp")
            break

    for sev in detect_severity_candidates(sample_event):
        if "severity" not in used_outputs:
            out.append(
                MappingCandidate(
                    output_field="severity",
                    source_json_path=sev["field_path"],
                    confidence=sev["confidence"],
                    reason=sev["reason"],
                    sample_value=sev["sample_value"],
                )
            )
            used_outputs.add("severity")
            break

    for ten in detect_tenant_candidates(sample_event):
        if "tenant_id" not in used_outputs:
            out.append(
                MappingCandidate(
                    output_field="tenant_id",
                    source_json_path=ten["field_path"],
                    confidence=ten["confidence"],
                    reason=ten["reason"],
                    sample_value=ten["sample_value"],
                )
            )
            used_outputs.add("tenant_id")
            break

    out.sort(key=lambda x: (-x["confidence"], x["output_field"]))
    return out
