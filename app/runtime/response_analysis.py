"""Reusable HTTP sample response analysis for Stream API Test / onboarding preview.

Keeps heuristics server-side so the frontend can stay thin.
"""

from __future__ import annotations

import copy
import json
import re
from typing import Any, Literal, TypedDict

from app.parsers.event_extractor import MappingError, extract_events
from app.runtime.errors import ParserError

CheckpointKind = Literal["TIMESTAMP", "EVENT_ID", "CURSOR", "OFFSET"]

_MAX_PREVIEW_JSON_CHARS = 4000
_MAX_FLAT_FIELDS = 220
_MAX_FLAT_DEPTH = 8
_MAX_ARRAY_SCAN_NODES = 4000

_EVENTISH_SEGMENTS = frozenset(
    {
        "items",
        "events",
        "results",
        "records",
        "data",
        "malops",
        "rows",
        "values",
        "entities",
        "findings",
        "alerts",
        "logs",
        "elements",
        "members",
        "list",
        "content",
    }
)

_TS_KEYS = frozenset(
    {
        "creationtime",
        "lastupdatetime",
        "updated_at",
        "timestamp",
        "time",
        "created_at",
        "captured_at",
        "eventtime",
        "occurred_at",
        "modified_at",
        "last_modified",
        "datetime",
        "date",
    }
)
_ID_KEYS = frozenset({"id", "guid", "uuid", "event_id", "malopid", "malop_id", "record_id", "identifier"})
_CURSOR_KEYS = frozenset({"cursor", "next_cursor", "nextcursor", "continuation_token", "page_token", "next_page_token"})
_OFFSET_KEYS = frozenset({"offset", "page", "skip", "start", "startindex"})


class _ArrayCand(TypedDict):
    path: str
    count: int
    confidence: float
    reason: str
    sample_item_preview: Any | None


class _CkptCand(TypedDict):
    field_path: str
    checkpoint_type: CheckpointKind
    confidence: float
    sample_value: Any | None
    reason: str


def _json_root_type(value: Any) -> str:
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


def _truncate_preview(value: Any) -> Any:
    try:
        text = json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(value)[:500]
    if len(text) <= _MAX_PREVIEW_JSON_CHARS:
        try:
            return json.loads(text) if text.startswith(("{", "[")) else value
        except json.JSONDecodeError:
            return value
    return text[:_MAX_PREVIEW_JSON_CHARS] + "…"


def _is_scalar(v: Any) -> bool:
    return v is None or isinstance(v, (bool, int, float, str))


def _homogeneity_score(items: list[Any]) -> float:
    dicts = [x for x in items[:5] if isinstance(x, dict)]
    if len(dicts) < 2:
        return 0.0
    key_sets = [set(d.keys()) for d in dicts]
    inter = set.intersection(*key_sets)
    union = set.union(*key_sets)
    if not union:
        return 0.0
    return len(inter) / len(union)


def _segment_name(path: str) -> str:
    clean = path.replace("$.", "", 1) if path.startswith("$.") else path
    parts = [p for p in re.split(r"\.|\[", clean) if p and not p.endswith("]")]
    return (parts[-1] if parts else "").lower()


def _array_confidence(path: str, count: int, items: list[Any]) -> tuple[float, str]:
    seg = _segment_name(path)
    reasons: list[str] = []
    score = 0.52
    if seg in _EVENTISH_SEGMENTS:
        score += 0.22
        reasons.append(f"segment {seg!r} commonly holds event lists")
    hom = _homogeneity_score(items)
    if hom >= 0.5:
        score += min(0.2, hom * 0.25)
        reasons.append("array of objects with repeated schema")
    if count >= 2:
        score += 0.06
        reasons.append("multiple items")
    if count >= 10:
        score += 0.04
    score = min(0.99, score)
    if not reasons:
        reasons.append("array of objects")
    return score, "; ".join(reasons)


def _walk_arrays(value: Any, path: str, out: list[_ArrayCand], budget: list[int]) -> None:
    if budget[0] <= 0:
        return
    budget[0] -= 1
    if isinstance(value, list):
        if value and isinstance(value[0], dict):
            conf, reason = _array_confidence(path, len(value), value)
            sample = _truncate_preview(value[0])
            out.append(
                _ArrayCand(
                    path=path,
                    count=len(value),
                    confidence=round(conf, 4),
                    reason=reason,
                    sample_item_preview=sample,
                )
            )
        for idx, item in enumerate(value[:15]):
            if isinstance(item, (dict, list)):
                child_path = f"{path}[{idx}]"
                _walk_arrays(item, child_path, out, budget)
        return
    if isinstance(value, dict):
        for k, v in value.items():
            child = f"$.{k}" if path == "$" else f"{path}.{k}"
            _walk_arrays(v, child, out, budget)


def detect_event_array_candidates(parsed: Any) -> list[_ArrayCand]:
    if parsed is None:
        return []
    out: list[_ArrayCand] = []
    if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
        conf, reason = _array_confidence("$", len(parsed), parsed)
        out.append(
            _ArrayCand(
                path="$",
                count=len(parsed),
                confidence=round(conf, 4),
                reason=reason,
                sample_item_preview=_truncate_preview(parsed[0]),
            )
        )
    budget = [_MAX_ARRAY_SCAN_NODES]
    _walk_arrays(parsed, "$", out, budget)
    out.sort(key=lambda x: (-x["confidence"], -x["count"]))
    seen: set[str] = set()
    uniq: list[_ArrayCand] = []
    for c in out:
        if c["path"] in seen:
            continue
        seen.add(c["path"])
        uniq.append(c)
    return uniq


def _iso8601_like(s: str) -> bool:
    return bool(re.search(r"\d{4}-\d{2}-\d{2}|\d{10,13}", s))


def _classify_checkpoint(key: str, value: Any) -> tuple[CheckpointKind, float, str] | None:
    lk = key.lower()
    if lk in _TS_KEYS or any(x in lk for x in ("time", "date", "timestamp", "created", "updated", "modified")):
        if isinstance(value, (int, float)):
            return "TIMESTAMP", 0.82, "numeric field with time-like name"
        if isinstance(value, str) and _iso8601_like(value):
            return "TIMESTAMP", 0.9, "string value resembles timestamp"
        if isinstance(value, str):
            return "TIMESTAMP", 0.55, "time-like field name"
    if lk in _ID_KEYS or lk.endswith("_id") or lk.endswith("id"):
        if isinstance(value, (str, int)):
            return "EVENT_ID", 0.88 if lk in _ID_KEYS else 0.72, "identifier-shaped field"
    if lk in _CURSOR_KEYS or "cursor" in lk or lk.endswith("_token"):
        if isinstance(value, (str, int)):
            return "CURSOR", 0.9 if lk in _CURSOR_KEYS else 0.65, "cursor / pagination token field"
    if lk in _OFFSET_KEYS:
        if isinstance(value, (int, float, str)) and str(value).isdigit():
            return "OFFSET", 0.8, "numeric offset / page field"
        if isinstance(value, (int, float)):
            return "OFFSET", 0.65, "offset-like field name"
    return None


def _scan_checkpoint_object(obj: dict[str, Any], base: str, out: list[_CkptCand]) -> None:
    for k, v in obj.items():
        path = f"$.{k}" if base == "$" else f"{base}.{k}"
        if _is_scalar(v):
            hit = _classify_checkpoint(k, v)
            if hit:
                ck, conf, reason = hit
                out.append(
                    _CkptCand(
                        field_path=path,
                        checkpoint_type=ck,
                        confidence=round(conf, 4),
                        sample_value=v,
                        reason=reason,
                    )
                )
        elif isinstance(v, dict):
            for k2, v2 in v.items():
                if not _is_scalar(v2):
                    continue
                path2 = f"{path}.{k2}"
                hit = _classify_checkpoint(k2, v2)
                if hit:
                    ck, conf, reason = hit
                    out.append(
                        _CkptCand(
                            field_path=path2,
                            checkpoint_type=ck,
                            confidence=round(conf, 4),
                            sample_value=v2,
                            reason=f"nested {reason}",
                        )
                    )


def detect_checkpoint_candidates(parsed_root: Any, sample_event: Any | None) -> list[_CkptCand]:
    out: list[_CkptCand] = []
    if isinstance(parsed_root, dict):
        _scan_checkpoint_object(parsed_root, "$", out)
    if isinstance(sample_event, dict) and sample_event is not parsed_root:
        _scan_checkpoint_object(sample_event, "$", out)
    out.sort(key=lambda x: -x["confidence"])
    seen: set[tuple[str, str]] = set()
    uniq: list[_CkptCand] = []
    for c in out:
        key = (c["field_path"], c["checkpoint_type"])
        if key in seen:
            continue
        seen.add(key)
        uniq.append(c)
    return uniq[:24]


def flatten_field_paths(obj: Any, *, max_fields: int = _MAX_FLAT_FIELDS, max_depth: int = _MAX_FLAT_DEPTH) -> list[str]:
    out: list[str] = []

    def walk(v: Any, path: str, depth: int) -> None:
        if len(out) >= max_fields or depth > max_depth:
            return
        if _is_scalar(v) or v is None:
            if path and path != "$":
                out.append(path)
            return
        if isinstance(v, list):
            if path and path != "$":
                out.append(path)
            return
        if isinstance(v, dict):
            if path and path != "$":
                out.append(path)
            for k, val in v.items():
                if len(out) >= max_fields:
                    break
                next_path = f"$.{k}" if path == "$" else f"{path}.{k}"
                walk(val, next_path, depth + 1)

    if isinstance(obj, dict):
        walk(obj, "$", 0)
    return out


def _path_for_extract(jsonpath_style: str | None) -> str | None:
    if not jsonpath_style or not str(jsonpath_style).strip():
        return None
    p = str(jsonpath_style).strip()
    if p == "$":
        return None
    return p


def normalize_event_array_hint(hint: str | None) -> str | None:
    if not hint or not str(hint).strip():
        return None
    h = str(hint).strip()
    return h if h.startswith("$") else f"$.{h}"


def pick_default_array_path(candidates: list[_ArrayCand], hint: str | None) -> str | None:
    if not candidates:
        return None
    nh = normalize_event_array_hint(hint)
    if nh:
        for c in candidates:
            if c["path"] == nh:
                return str(c["path"])
        tail = nh[2:] if nh.startswith("$.") else nh
        for c in candidates:
            p = str(c["path"])
            ptail = p[2:] if p.startswith("$.") else p
            if ptail == tail or ptail.endswith("." + tail):
                return p
    first = candidates[0]
    return str(first["path"]) if float(first["confidence"]) >= 0.4 else None


def classify_preview_issue(
    *,
    parsed: Any | None,
    raw_body: str | None,
    content_type: str | None,
    body_truncated: bool,
) -> str | None:
    if parsed is not None:
        return None
    if body_truncated:
        return "response_too_large"
    raw = (raw_body or "").strip()
    ct = (content_type or "").lower()
    if "text/html" in ct or raw.lower().startswith("<!doctype") or raw.lower().startswith("<html"):
        return "unsupported_content_type"
    if "application/json" in ct or raw.startswith("{") or raw.startswith("["):
        return "invalid_json_response"
    if raw.startswith("<"):
        return "unsupported_content_type"
    if not raw:
        return None
    return "unsupported_content_type"


def build_http_api_test_analysis_dict(
    parsed: Any | None,
    *,
    raw_body: str | None = None,
    raw_body_length: int | None = None,
    body_truncated: bool = False,
    content_type: str | None = None,
    event_array_hint: str | None = None,
) -> dict[str, Any]:
    rlen = int(raw_body_length if raw_body_length is not None else len(raw_body or ""))
    preview_error = classify_preview_issue(
        parsed=parsed,
        raw_body=raw_body,
        content_type=content_type,
        body_truncated=body_truncated,
    )

    if parsed is None:
        summary: dict[str, Any] = {
            "root_type": "null",
            "approx_size_bytes": rlen,
            "top_level_keys": [],
            "item_count_root": None,
            "truncation": "response_truncated" if body_truncated else None,
        }
        return {
            "response_summary": summary,
            "detected_arrays": [],
            "detected_checkpoint_candidates": [],
            "sample_event": None,
            "selected_event_array_default": None,
            "flat_preview_fields": [],
            "preview_error": preview_error,
        }

    try:
        approx = len(json.dumps(parsed, ensure_ascii=False))
    except (TypeError, ValueError):
        approx = rlen
    summary = {
        "root_type": _json_root_type(parsed),
        "approx_size_bytes": max(rlen, approx),
        "top_level_keys": list(parsed.keys())[:80] if isinstance(parsed, dict) else [],
        "item_count_root": len(parsed) if isinstance(parsed, list) else None,
        "truncation": "response_truncated" if body_truncated else None,
    }
    arrays = detect_event_array_candidates(parsed)
    default_path = pick_default_array_path(arrays, event_array_hint)

    sample_event: Any | None = None
    flat: list[str] = []
    try:
        ev_path = _path_for_extract(default_path)
        events = extract_events(parsed, ev_path)
        if events:
            sample_event = copy.deepcopy(events[0])
            flat = flatten_field_paths(sample_event)
    except (MappingError, ParserError, TypeError, ValueError):
        sample_event = None

    if sample_event is None:
        try:
            events = extract_events(parsed, None)
            if events:
                sample_event = copy.deepcopy(events[0])
                flat = flatten_field_paths(sample_event)
        except (MappingError, ParserError, TypeError, ValueError):
            sample_event = None

    checkpoints = detect_checkpoint_candidates(parsed, sample_event)

    return {
        "response_summary": summary,
        "detected_arrays": arrays,
        "detected_checkpoint_candidates": checkpoints,
        "sample_event": _truncate_preview(sample_event) if sample_event is not None else None,
        "selected_event_array_default": default_path,
        "flat_preview_fields": flat,
        "preview_error": None,
    }
