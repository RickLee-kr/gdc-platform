"""Governance delivery_behavior normalization (M13.5)."""

from __future__ import annotations

from typing import Any

_DELIVERY_BEHAVIOR_ALIASES = {
    "continue": "continue",
    "continue_delivery": "continue",
    "allow": "continue",
    "block": "block",
    "quarantine": "quarantine",
    "require_review": "require_review",
    "review": "require_review",
}


def normalize_delivery_behavior(raw: Any) -> str | None:
    if raw is None:
        return None
    key = str(raw).strip().lower()
    return _DELIVERY_BEHAVIOR_ALIASES.get(key)
