"""Extract discrete events from raw API responses using optional JSONPath."""

from __future__ import annotations

import copy
from typing import Any

from app.parsers.jsonpath_parser import find_values
from app.runtime.errors import MappingError


def _is_primitive_json(value: Any) -> bool:
    """Return True for JSON scalar types (excluding dict/list)."""

    return value is None or isinstance(value, bool | int | float | str)


def extract_events(raw_response: Any, event_array_path: str | None = None) -> list[dict[str, Any]]:
    """Return a list of event dicts from ``raw_response``.

    Does not perform mapping or enrichment — structure normalization only.

    Rules:
    - If ``event_array_path`` is ``None`` or blank after strip:
        - ``dict`` → ``[deepcopy(dict)]``
        - ``list`` → each element must be a ``dict``; otherwise :class:`MappingError`.
        - Any other type → :class:`MappingError`.
    - If ``event_array_path`` is set:
        - Root must be ``dict`` or ``list`` (JSON object/array). Primitives →
          :class:`MappingError`.
        - Evaluate JSONPath with :func:`app.parsers.jsonpath_parser.find_values`.
        - Zero matches → ``[]``.
        - Single match:
            - If value is ``list`` → each item must be a ``dict``; else
              :class:`MappingError`.
            - If value is ``dict`` → ``[copy]``.
            - Otherwise (primitive / ``None``) → :class:`MappingError``.
        - Multiple matches → each matched value must be a ``dict``;
          :class:`MappingError` if any are not.

    Raises:
        MappingError: Structural mismatch or non-dict event candidates.
        ParserError: Invalid JSONPath expression (from jsonpath layer).

    Returns:
        A possibly empty list of deep-copied event dicts.
    """

    path_set = event_array_path is not None and event_array_path.strip() != ""

    if not path_set:
        if isinstance(raw_response, dict):
            return [copy.deepcopy(raw_response)]
        if isinstance(raw_response, list):
            events: list[dict[str, Any]] = []
            for idx, item in enumerate(raw_response):
                if not isinstance(item, dict):
                    raise MappingError(
                        f"Expected dict items in raw list at index {idx}, "
                        f"got {type(item).__name__}"
                    )
                events.append(copy.deepcopy(item))
            return events
        raise MappingError(
            "Without event_array_path, raw_response must be a dict or list, "
            f"got {type(raw_response).__name__}"
        )

    if _is_primitive_json(raw_response) or isinstance(raw_response, tuple):
        raise MappingError(
            "With event_array_path, raw_response must be a dict or list root, "
            f"got {type(raw_response).__name__}"
        )

    matches = find_values(raw_response, event_array_path)

    if not matches:
        return []

    if len(matches) == 1:
        value = matches[0]
        if isinstance(value, list):
            return _dict_events_from_sequence(value, context="event_array_path list result")
        if isinstance(value, dict):
            return [copy.deepcopy(value)]
        raise MappingError(
            "event_array_path must resolve to a dict or list of dicts; "
            f"got {type(value).__name__}"
        )

    out: list[dict[str, Any]] = []
    for i, value in enumerate(matches):
        if not isinstance(value, dict):
            raise MappingError(
                "Multiple JSONPath matches must each be dict events; "
                f"match {i} is {type(value).__name__}"
            )
        out.append(copy.deepcopy(value))
    return out


def _dict_events_from_sequence(items: list[Any], *, context: str) -> list[dict[str, Any]]:
    """Ensure sequence elements are dicts and return deep copies."""

    result: list[dict[str, Any]] = []
    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            raise MappingError(
                f"{context}: expected dict at index {idx}, got {type(item).__name__}"
            )
        result.append(copy.deepcopy(item))
    return result
