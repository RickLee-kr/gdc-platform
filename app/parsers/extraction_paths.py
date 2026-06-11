"""Event extraction path helpers (parity with frontend record-selection utilities).

Persisted paths must never include preview-only indices ([0]) on the array path.
Runtime extraction expressions use ``[*]`` wildcards; preview sample paths use ``[0]``.
"""

from __future__ import annotations

import re

_TRAILING_INDEX = re.compile(r"\[\d+\]$|\[\*\]$")


def normalize_event_array_path(path: str | None) -> str:
    """Strip preview indices from array path before persistence."""

    p = (path or "").strip()
    if not p:
        return ""
    if not p.startswith("$"):
        p = f"${p}" if p.startswith(".") else f"$.{p}"
    while _TRAILING_INDEX.search(p):
        p = _TRAILING_INDEX.sub("", p)
    return p


def normalize_event_root_path(path: str | None) -> str:
    """Normalize event_root_path for persistence (relative to each array item)."""

    p = (path or "").strip()
    if not p or p == "$":
        return ""
    return p if p.startswith("$") else f"$.{p}"


def format_runtime_extraction_path(event_array_path: str | None, event_root_path: str | None) -> str:
    """Runtime extraction expression for operator summary (not persisted)."""

    arr = normalize_event_array_path(event_array_path)
    arr_wildcard = "$[*]" if not arr or arr == "$" else f"{arr}[*]"
    root = normalize_event_root_path(event_root_path)
    if not root:
        return arr_wildcard
    root_suffix = root[1:] if root.startswith("$") else f".{root}"
    return f"{arr_wildcard}{root_suffix}"


def format_preview_sample_path(event_array_path: str | None, sample_index: int = 0) -> str:
    """Preview-only path for one sample record (UI/debug)."""

    arr = normalize_event_array_path(event_array_path)
    idx = max(0, int(sample_index))
    if not arr or arr == "$":
        return f"$[{idx}]"
    return f"{arr}[{idx}]"


def checkpoint_path_from_click(
    clicked_path: str,
    event_array_path: str | None,
    preview_sample_index: int = 0,
) -> str:
    """Convert a raw-tree JSONPath click into checkpoint path relative to each array record."""

    full = (clicked_path or "").strip()
    if not full:
        return ""

    sample_record = format_preview_sample_path(event_array_path, preview_sample_index)
    array_norm = normalize_event_array_path(event_array_path) or "$"

    strip_prefixes: list[str] = [sample_record]
    if array_norm != sample_record:
        strip_prefixes.extend([f"{array_norm}[0]", array_norm, f"{array_norm}[*]"])
    if array_norm == "$":
        strip_prefixes.extend(["$[0]", "$"])

    for prefix in strip_prefixes:
        if not prefix:
            continue
        if full == prefix:
            return ""
        if full.startswith(f"{prefix}."):
            rel = full[len(prefix) + 1 :]
            return rel if rel.startswith("$") else f"$.{rel}"

    if full.startswith("$."):
        return full
    if full.startswith("$"):
        tail = full[1:].lstrip(".")
        return f"$.{tail}" if tail else ""
    return f"$.{full.lstrip('.')}"


def to_checkpoint_relative_path(
    clicked_path: str,
    event_array_path: str | None,
    _event_root_path: str | None = None,
    preview_sample_index: int = 0,
) -> str:
    return checkpoint_path_from_click(clicked_path, event_array_path, preview_sample_index)


def event_root_path_from_click(clicked_path: str, event_array_path: str | None) -> str:
    """Convert a raw-tree JSONPath click into persisted event_root_path (relative to each array item)."""

    full = (clicked_path or "").strip()
    if not full:
        return ""

    array_norm = normalize_event_array_path(event_array_path) or "$"

    if array_norm == "$":
        match = re.match(r"^\$(?:\[\d+\])?(?:\.(.+))?$", full)
        if not match or not match.group(1):
            return ""
        return f"$.{match.group(1)}"

    prefixes = [f"{array_norm}[0]", array_norm, f"{array_norm}[*]"]
    for prefix in prefixes:
        if full == prefix:
            return ""
        if full.startswith(f"{prefix}."):
            rest = full[len(prefix) + 1 :]
            return rest if rest.startswith("$") else f"$.{rest}"
        if full.startswith(f"{prefix}["):
            rest = full[len(prefix) :]
            rest = re.sub(r"^\[\d+\]\.?", "", rest)
            if not rest:
                return ""
            return rest if rest.startswith("$") else f"$.{rest}"

    if full.startswith("$."):
        return full
    return normalize_event_root_path(full)


def absolute_path_in_sample_record(
    event_array_path: str | None,
    record_relative_path: str,
    sample_index: int = 0,
) -> str:
    """Absolute JSONPath in raw payload for highlighting a record-relative field."""

    rel = (record_relative_path or "").strip()
    if not rel:
        return format_preview_sample_path(event_array_path, sample_index)
    record = format_preview_sample_path(event_array_path, sample_index)
    if rel.startswith("$"):
        suffix = rel[1:]
    elif rel.startswith("."):
        suffix = rel
    else:
        suffix = f".{rel}"
    return f"{record}{suffix}"


def format_checkpoint_applies_to(event_array_path: str | None, checkpoint_relative_path: str | None) -> str:
    base = format_runtime_extraction_path(event_array_path, "")
    cp = (checkpoint_relative_path or "").strip()
    if not cp:
        return base
    suffix = cp[1:] if cp.startswith("$") else f".{cp}"
    return f"{base}{suffix}"


def is_preview_only_array_path(path: str | None) -> bool:
    """Return True when the array path still contains a literal sample index."""

    raw = (path or "").strip()
    norm = normalize_event_array_path(path)
    return raw != norm and bool(re.search(r"\[\d+\]", raw))


_ROOT_ARRAY_INDEX = re.compile(r"^\$\[[\d\*]+\]")


def _path_references_prefix(path: str, prefix: str) -> bool:
    """True when ``path`` still traverses through ``prefix`` in the raw envelope."""

    if not prefix:
        return False
    if path == prefix:
        return True
    if path.startswith(f"{prefix}."):
        return True
    if path.startswith(f"{prefix}["):
        return True
    return False


def is_envelope_relative_mapping_path(
    mapping_path: str | None,
    event_array_path: str | None,
    event_root_path: str | None = None,
) -> bool:
    """Return True when a mapping JSONPath references the raw envelope instead of the extracted event."""

    path = (mapping_path or "").strip()
    if not path:
        return False

    array_norm = normalize_event_array_path(event_array_path) or "$"
    root = normalize_event_root_path(event_root_path)

    if array_norm == "$":
        if _ROOT_ARRAY_INDEX.match(path):
            return True
    else:
        for prefix in (array_norm, f"{array_norm}[0]", f"{array_norm}[*]"):
            if _path_references_prefix(path, prefix):
                return True

    if root and _path_references_prefix(path, root):
        return True

    return False


ENVELOPE_RELATIVE_MAPPING_PATH_MESSAGE = (
    "Mapping paths must be relative to the extracted event, not the raw response envelope."
)


def validate_mapping_paths_for_extraction(
    field_mappings: dict[str, str | object] | None,
    event_array_path: str | None,
    event_root_path: str | None = None,
) -> list[dict[str, str]]:
    """Return structured violations for mapping paths that break the extraction contract."""

    from app.mappers.full_event_mapping import FIELD_MAPPINGS_META_KEYS, is_full_event_mapping
    from app.mappers.mapping_rules import parse_mapping_rule

    if is_full_event_mapping(dict(field_mappings or {})):
        return []

    violations: list[dict[str, str]] = []
    for output_field, raw_value in dict(field_mappings or {}).items():
        if str(output_field) in FIELD_MAPPINGS_META_KEYS:
            continue
        rule = parse_mapping_rule(str(output_field), raw_value)
        if rule is None:
            continue
        if is_envelope_relative_mapping_path(rule.source_json_path, event_array_path, event_root_path):
            violations.append(
                {
                    "code": "ENVELOPE_RELATIVE_MAPPING_PATH",
                    "output_field": rule.output_field,
                    "json_path": rule.source_json_path,
                    "message": ENVELOPE_RELATIVE_MAPPING_PATH_MESSAGE,
                }
            )
    return violations
