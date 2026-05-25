"""Detect likely event array paths in JSON API responses."""

from __future__ import annotations

import json
import re
from typing import Any, TypedDict

_MAX_PREVIEW_JSON_CHARS = 4000
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


class ArrayCandidate(TypedDict):
    path: str
    count: int
    confidence: float
    reason: str
    sample_item_preview: Any | None


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


def _walk_arrays(value: Any, path: str, out: list[ArrayCandidate], budget: list[int]) -> None:
    if budget[0] <= 0:
        return
    budget[0] -= 1
    if isinstance(value, list):
        if value and isinstance(value[0], dict):
            conf, reason = _array_confidence(path, len(value), value)
            sample = _truncate_preview(value[0])
            out.append(
                ArrayCandidate(
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


def detect_event_array_candidates(parsed: Any) -> list[ArrayCandidate]:
    if parsed is None:
        return []
    out: list[ArrayCandidate] = []
    if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
        conf, reason = _array_confidence("$", len(parsed), parsed)
        out.append(
            ArrayCandidate(
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
    uniq: list[ArrayCandidate] = []
    for c in out:
        if c["path"] in seen:
            continue
        seen.add(c["path"])
        uniq.append(c)
    return uniq


def normalize_event_array_hint(hint: str | None) -> str | None:
    if not hint or not str(hint).strip():
        return None
    h = str(hint).strip()
    return h if h.startswith("$") else f"$.{h}"


def pick_default_array_path(candidates: list[ArrayCandidate], hint: str | None) -> str | None:
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
