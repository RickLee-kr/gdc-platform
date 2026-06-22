"""Safe field removal at JSONPath-style field paths."""

from __future__ import annotations

from typing import Any

from app.protection.engine import parse_field_path_segments


def remove_field_at_path(event: dict[str, Any], field_path: str) -> int:
    """Remove ``field_path`` from ``event`` (mutates in place). Returns removal count."""

    segments = parse_field_path_segments(str(field_path))
    if not segments:
        return 0
    return _drop_at_segments(event, segments, 0)


def _drop_at_segments(node: Any, segments: list[str], seg_index: int) -> int:
    if seg_index >= len(segments):
        return 0

    seg = segments[seg_index]
    is_last = seg_index == len(segments) - 1

    if seg == "[]":
        if not isinstance(node, list):
            return 0
        total = 0
        for item in node:
            total += _drop_at_segments(item, segments, seg_index + 1)
        return total

    if is_last:
        if isinstance(node, dict) and seg in node:
            del node[seg]
            return 1
        return 0

    if not isinstance(node, dict) or seg not in node:
        return 0

    child = node[seg]
    next_seg = segments[seg_index + 1] if seg_index + 1 < len(segments) else None
    if next_seg == "[]":
        if not isinstance(child, list):
            return 0
        total = 0
        for item in child:
            total += _drop_at_segments(item, segments, seg_index + 2)
        return total

    return _drop_at_segments(child, segments, seg_index + 1)
