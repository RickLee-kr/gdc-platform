"""Event field names for classification output."""

from __future__ import annotations

from typing import Any

CLASSIFICATION_LEVEL_FIELD = "classification_level"
CLASSIFICATION_LEVEL_GDC_FIELD = "classification_level_gdc"


def read_classification_level(event: dict[str, Any]) -> str | None:
    raw = event.get(CLASSIFICATION_LEVEL_GDC_FIELD)
    if raw is None:
        raw = event.get(CLASSIFICATION_LEVEL_FIELD)
    if raw is None:
        return None
    return str(raw)


def stamp_classification_level(event: dict[str, Any], level: str) -> None:
    if CLASSIFICATION_LEVEL_FIELD in event:
        event[CLASSIFICATION_LEVEL_GDC_FIELD] = level
    else:
        event[CLASSIFICATION_LEVEL_FIELD] = level
