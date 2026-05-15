"""WEBHOOK_POST JSON body shape: one object per request vs batched JSON array."""

from __future__ import annotations

from typing import Any, Literal

WEBHOOK_PAYLOAD_MODE_SINGLE = "SINGLE_EVENT_OBJECT"
WEBHOOK_PAYLOAD_MODE_BATCH = "BATCH_JSON_ARRAY"

WebhookPayloadModeLiteral = Literal["SINGLE_EVENT_OBJECT", "BATCH_JSON_ARRAY"]

_VALID = frozenset({WEBHOOK_PAYLOAD_MODE_SINGLE, WEBHOOK_PAYLOAD_MODE_BATCH})


def normalize_webhook_payload_mode(raw: Any) -> WebhookPayloadModeLiteral | None:
    """Return canonical mode if ``raw`` is a non-empty valid string, else ``None``."""

    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if s in _VALID:
        return s  # type: ignore[return-value]
    raise ValueError(
        f"Invalid webhook payload_mode: {raw!r}. "
        f"Expected {WEBHOOK_PAYLOAD_MODE_SINGLE!r} or {WEBHOOK_PAYLOAD_MODE_BATCH!r}."
    )


def resolve_webhook_payload_mode(destination_config: dict[str, Any]) -> WebhookPayloadModeLiteral:
    """Default ``SINGLE_EVENT_OBJECT`` when ``payload_mode`` is absent."""

    mode = normalize_webhook_payload_mode(destination_config.get("payload_mode"))
    return mode or WEBHOOK_PAYLOAD_MODE_SINGLE
