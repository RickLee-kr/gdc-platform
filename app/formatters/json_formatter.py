"""JSON/webhook preview formatter utilities."""

from __future__ import annotations

from typing import Any


def format_webhook_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return webhook preview payload without mutation."""

    return list(events)
