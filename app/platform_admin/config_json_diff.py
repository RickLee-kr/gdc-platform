"""Structured JSON diff for operator-facing configuration comparisons."""

from __future__ import annotations

from typing import Any


def _is_scalar(v: Any) -> bool:
    return v is None or isinstance(v, (str, int, float, bool))


def diff_json(before: Any, after: Any, *, path: str = "") -> list[dict[str, Any]]:
    """Return a list of change records with dotted paths (no array indices in this MVP)."""

    out: list[dict[str, Any]] = []

    if _is_scalar(before) and _is_scalar(after):
        if before != after:
            out.append({"path": path or "$", "change": "modified", "old": before, "new": after})
        return out

    if isinstance(before, dict) and isinstance(after, dict):
        keys = sorted(set(before.keys()) | set(after.keys()))
        for k in keys:
            p = f"{path}.{k}" if path else str(k)
            if k not in before:
                out.append({"path": p, "change": "added", "old": None, "new": after[k]})
            elif k not in after:
                out.append({"path": p, "change": "removed", "old": before[k], "new": None})
            else:
                out.extend(diff_json(before[k], after[k], path=p))
        return out

    if isinstance(before, list) and isinstance(after, list):
        if before != after:
            out.append({"path": path or "$", "change": "modified", "old": before, "new": after})
        return out

    if type(before) is not type(after) or before != after:
        out.append({"path": path or "$", "change": "modified", "old": before, "new": after})
    return out


def effective_snapshot_side(row_before: dict[str, Any] | None, row_after: dict[str, Any] | None, *, side: str) -> dict[str, Any] | None:
    """Pick a comparable JSON document from a version row (``side`` is ``before`` or ``after``)."""

    if side == "before":
        return row_before
    if side == "after":
        return row_after if row_after is not None else row_before
    raise ValueError("side must be before or after")
