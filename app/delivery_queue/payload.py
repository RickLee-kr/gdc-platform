"""Payload helpers for durable delivery queue items.

Stores protected/delivery-ready event batches only — never destination/source
auth credentials (audit design §Q6).
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.security.secrets import is_sensitive_field_name

_MAX_EVENTS = 500
_MAX_LAST_ERROR = 2048


class QueuePayloadSecretError(ValueError):
    """Raised when enqueue payload contains credential/secret fields."""

    def __init__(self, field_path: str) -> None:
        self.field_path = field_path
        super().__init__(f"queue payload must not contain secret field: {field_path}")


def truncate_last_error(message: str | None, *, max_len: int = _MAX_LAST_ERROR) -> str | None:
    if message is None:
        return None
    text = str(message)
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


def _assert_no_secrets(value: Any, *, path: str) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            key_s = str(key)
            child = f"{path}.{key_s}" if path else key_s
            if is_sensitive_field_name(key_s) and item not in (None, ""):
                raise QueuePayloadSecretError(child)
            _assert_no_secrets(item, path=child)
        return
    if isinstance(value, list):
        for idx, item in enumerate(value):
            _assert_no_secrets(item, path=f"{path}[{idx}]")


def assert_payload_has_no_secrets(payload: dict[str, Any]) -> None:
    """Reject payloads that embed auth/credential fields."""

    _assert_no_secrets(payload, path="")


def normalize_queue_payload(events: list[dict[str, Any]] | dict[str, Any]) -> dict[str, Any]:
    """Normalize to ``{"events": [...]}`` and reject secret leakage."""

    if isinstance(events, dict):
        if "events" in events and isinstance(events["events"], list):
            payload = deepcopy(events)
            payload["events"] = [
                deepcopy(item) for item in payload["events"][:_MAX_EVENTS] if isinstance(item, dict)
            ]
        else:
            # Treat a single event dict as one-element batch.
            payload = {"events": [deepcopy(events)]}
    else:
        payload = {
            "events": [deepcopy(item) for item in list(events)[:_MAX_EVENTS] if isinstance(item, dict)]
        }
    assert_payload_has_no_secrets(payload)
    return payload
