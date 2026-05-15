"""JSON/webhook preview formatter utilities."""

from __future__ import annotations

from typing import Any

from app.delivery.webhook_payload_mode import (
    WEBHOOK_PAYLOAD_MODE_BATCH,
    WEBHOOK_PAYLOAD_MODE_SINGLE,
)


def format_webhook_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return webhook preview payload without mutation."""

    return list(events)


def build_webhook_http_preview_messages(
    events: list[dict[str, Any]],
    payload_mode: str,
    *,
    batch_size: int | None = None,
) -> list[Any]:
    """Build one preview entry per HTTP POST JSON body (object or array of objects)."""

    if not events:
        return []
    if payload_mode == WEBHOOK_PAYLOAD_MODE_SINGLE:
        return [dict(e) for e in events]
    if payload_mode != WEBHOOK_PAYLOAD_MODE_BATCH:
        raise ValueError(f"Unsupported webhook payload_mode: {payload_mode!r}")
    bs = max(1, int(batch_size or len(events)))
    return [format_webhook_events(events[i : i + bs]) for i in range(0, len(events), bs)]
