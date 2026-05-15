"""Generic JSON webhook delivery."""

from __future__ import annotations

from typing import Any


def body_for_generic_webhook(payload: dict[str, Any]) -> dict[str, Any]:
    """Return JSON body for a generic receiver (no vendor-specific wrapping)."""

    return payload
