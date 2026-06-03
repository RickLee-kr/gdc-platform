"""Walk extracted event dicts and collect JSONPath-style field paths with inferred types."""

from __future__ import annotations

from typing import Any

# Coarse types for observation (not drift signals).
TYPE_NULL = "null"
TYPE_BOOLEAN = "boolean"
TYPE_INTEGER = "integer"
TYPE_NUMBER = "number"
TYPE_STRING = "string"
TYPE_OBJECT = "object"
TYPE_ARRAY = "array"
TYPE_MIXED = "mixed"

_ARRAY_SAMPLE_SIZE = 3


def infer_value_type(value: Any) -> str:
    if value is None:
        return TYPE_NULL
    if isinstance(value, bool):
        return TYPE_BOOLEAN
    if isinstance(value, int) and not isinstance(value, bool):
        return TYPE_INTEGER
    if isinstance(value, float):
        return TYPE_NUMBER
    if isinstance(value, str):
        return TYPE_STRING
    if isinstance(value, dict):
        return TYPE_OBJECT
    if isinstance(value, list):
        return TYPE_ARRAY
    return TYPE_STRING


def merge_inferred_types(existing: str | None, new: str) -> str:
    if not existing or existing == new:
        return new
    if existing == TYPE_MIXED or new == TYPE_MIXED:
        return TYPE_MIXED
    numeric = {TYPE_INTEGER, TYPE_NUMBER}
    if existing in numeric and new in numeric:
        return TYPE_NUMBER
    if {existing, new} <= {TYPE_NULL, existing} or {existing, new} <= {TYPE_NULL, new}:
        return new if existing == TYPE_NULL else existing
    return TYPE_MIXED


def walk_event_fields(
    value: Any,
    *,
    path: str,
    depth: int,
    max_depth: int,
    out: dict[str, str],
    max_paths: int,
) -> None:
    if len(out) >= max_paths or depth > max_depth:
        return

    value_type = infer_value_type(value)
    out[path] = merge_inferred_types(out.get(path), value_type)
    if len(out) >= max_paths:
        return

    if value_type == TYPE_OBJECT and isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str):
                continue
            child_path = f"{path}.{key}" if path != "$" else f"$.{key}"
            walk_event_fields(
                child,
                path=child_path,
                depth=depth + 1,
                max_depth=max_depth,
                out=out,
                max_paths=max_paths,
            )
            if len(out) >= max_paths:
                return
    elif value_type == TYPE_ARRAY and isinstance(value, list):
        array_path = f"{path}[]"
        out[array_path] = merge_inferred_types(out.get(array_path), TYPE_ARRAY)
        for item in value[:_ARRAY_SAMPLE_SIZE]:
            if isinstance(item, dict):
                for key, child in item.items():
                    if not isinstance(key, str):
                        continue
                    child_path = f"{array_path}.{key}"
                    walk_event_fields(
                        child,
                        path=child_path,
                        depth=depth + 1,
                        max_depth=max_depth,
                        out=out,
                        max_paths=max_paths,
                    )
                    if len(out) >= max_paths:
                        return
            else:
                element_path = f"{array_path}[]"
                walk_event_fields(
                    item,
                    path=element_path,
                    depth=depth + 1,
                    max_depth=max_depth,
                    out=out,
                    max_paths=max_paths,
                )
                if len(out) >= max_paths:
                    return


def collect_paths_from_event(
    event: Any,
    *,
    max_depth: int,
    max_paths: int,
) -> dict[str, str]:
    """Return path -> inferred type for one extracted event."""

    paths: dict[str, str] = {}
    if not isinstance(event, dict):
        walk_event_fields(
            event,
            path="$",
            depth=0,
            max_depth=max_depth,
            out=paths,
            max_paths=max_paths,
        )
        return paths

    for key, value in event.items():
        if not isinstance(key, str):
            continue
        walk_event_fields(
            value,
            path=f"$.{key}",
            depth=0,
            max_depth=max_depth,
            out=paths,
            max_paths=max_paths,
        )
        if len(paths) >= max_paths:
            break
    return paths


def collect_paths_from_events(
    events: list[Any],
    *,
    max_depth: int,
    max_paths: int,
    max_events: int,
) -> dict[str, str]:
    """Merge path inventories from up to ``max_events`` events in one batch."""

    merged: dict[str, str] = {}
    for event in events[:max_events]:
        for path, typ in collect_paths_from_event(event, max_depth=max_depth, max_paths=max_paths).items():
            merged[path] = merge_inferred_types(merged.get(path), typ)
            if len(merged) >= max_paths:
                return merged
    return merged
