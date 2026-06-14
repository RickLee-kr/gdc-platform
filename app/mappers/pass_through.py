"""Unknown field pass-through for basic JSONPath mapping.

After mapped fields are extracted, unmapped source structure is preserved:
- top-level keys not fully consumed
- nested siblings inside partially mapped objects
- array elements with partially mapped fields
"""

from __future__ import annotations

import re
from typing import Any, Iterable

from app.runtime.copy_utils import copy_json_value

_SEGMENT_RE = re.compile(r"[^.\[]+")


def maps_whole_event(source_json_paths: Iterable[str]) -> bool:
    for path in source_json_paths:
        if path.strip() in ("$", ""):
            return True
    return False


def parse_jsonpath_segments(path: str) -> list[str | int]:
    """Parse ``$.user.name`` / ``$.items[0].tag`` into navigable segments."""

    p = path.strip()
    if p in ("$", ""):
        return []
    if p.startswith("$."):
        remainder = p[2:]
    elif p.startswith("$"):
        remainder = p[1:].lstrip(".")
    else:
        remainder = p

    segments: list[str | int] = []
    i = 0
    while i < len(remainder):
        if remainder[i] == ".":
            i += 1
            continue
        if remainder[i] == "[":
            end = remainder.index("]", i)
            raw = remainder[i + 1 : end].strip()
            if raw.isdigit():
                segments.append(int(raw))
            i = end + 1
            continue
        match = _SEGMENT_RE.match(remainder, i)
        if not match:
            break
        segments.append(match.group(0))
        i = match.end()
    return segments


def _is_empty_container(value: Any) -> bool:
    if isinstance(value, dict):
        return len(value) == 0
    if isinstance(value, list):
        return len(value) == 0
    return False


def _prune_empty_containers(node: Any) -> None:
    if isinstance(node, dict):
        for key in list(node.keys()):
            child = node[key]
            _prune_empty_containers(child)
            if _is_empty_container(child):
                del node[key]
    elif isinstance(node, list):
        for idx in range(len(node) - 1, -1, -1):
            child = node[idx]
            _prune_empty_containers(child)
            if _is_empty_container(child):
                node.pop(idx)


def remove_at_jsonpath(root: dict[str, Any], path: str) -> None:
    """Remove the value at ``path`` from ``root`` and prune empty parents."""

    segments = parse_jsonpath_segments(path)
    if not segments:
        root.clear()
        return

    def remove_at(parent: Any, remaining: list[str | int]) -> None:
        if not remaining:
            return
        key = remaining[0]
        rest = remaining[1:]

        if isinstance(key, int):
            if not isinstance(parent, list) or key < 0 or key >= len(parent):
                return
            if not rest:
                parent.pop(key)
                return
            remove_at(parent[key], rest)
            if _is_empty_container(parent[key]):
                parent.pop(key)
            return

        if not isinstance(parent, dict) or key not in parent:
            return
        if not rest:
            del parent[key]
            return
        remove_at(parent[key], rest)
        if _is_empty_container(parent[key]):
            del parent[key]

    remove_at(root, segments)
    _prune_empty_containers(root)


def deep_merge_pass_through(output: dict[str, Any], residual: dict[str, Any]) -> dict[str, Any]:
    """Merge ``residual`` into ``output`` without overwriting existing output values."""

    merged = copy_json_value(output)

    def merge_into(target: Any, source: Any) -> None:
        if not isinstance(target, dict) or not isinstance(source, dict):
            return
        for key, src_val in source.items():
            if key not in target:
                target[key] = copy_json_value(src_val)
                continue
            tgt_val = target[key]
            if isinstance(tgt_val, dict) and isinstance(src_val, dict):
                merge_into(tgt_val, src_val)
            elif isinstance(tgt_val, list) and isinstance(src_val, list):
                merge_arrays(tgt_val, src_val)

    def merge_arrays(target: list[Any], source: list[Any]) -> None:
        for idx, src_item in enumerate(source):
            if idx >= len(target):
                target.append(copy_json_value(src_item))
                continue
            tgt_item = target[idx]
            if isinstance(tgt_item, dict) and isinstance(src_item, dict):
                merge_into(tgt_item, src_item)
            elif isinstance(tgt_item, list) and isinstance(src_item, list):
                merge_arrays(tgt_item, src_item)

    merge_into(merged, residual)
    return merged


def build_residual_after_mapping(event: dict[str, Any], source_json_paths: Iterable[str]) -> dict[str, Any]:
    residual = copy_json_value(event)
    for path in source_json_paths:
        remove_at_jsonpath(residual, path)
    _prune_empty_containers(residual)
    return residual


def merge_unknown_field_pass_through(
    event: dict[str, Any],
    output: dict[str, Any],
    source_json_paths: Iterable[str],
) -> dict[str, Any]:
    """Copy unmapped source structure into ``output`` (non-mutating merge)."""

    if not isinstance(event, dict):
        return output

    if maps_whole_event(source_json_paths):
        return output

    residual = build_residual_after_mapping(event, source_json_paths)
    if not residual:
        return output

    return deep_merge_pass_through(output, residual)


# Backward-compatible helpers used in tests / diagnostics.
def mapped_top_level_keys(source_json_paths: Iterable[str]) -> set[str]:
    roots: set[str] = set()
    for path in source_json_paths:
        segments = parse_jsonpath_segments(path)
        if segments and isinstance(segments[0], str):
            roots.add(segments[0])
    return roots


__all__ = [
    "build_residual_after_mapping",
    "deep_merge_pass_through",
    "merge_unknown_field_pass_through",
    "mapped_top_level_keys",
    "maps_whole_event",
    "parse_jsonpath_segments",
    "remove_at_jsonpath",
]
