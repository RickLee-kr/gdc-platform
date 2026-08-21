"""Build minimal, isolated delivery_logs.payload_sample rows."""

from __future__ import annotations

from typing import Any

from app.runtime.copy_utils import copy_events, copy_json_value, slim_checkpoint_for_log
from app.security.secrets import mask_secrets_and_pem

_REPLAY_EVENT_KEYS = frozenset({"replay_events", "enriched_events", "events"})
_CHECKPOINT_KEYS = frozenset({"checkpoint_before", "checkpoint_after"})
# Drop bulky mirrors; replay_events is handled explicitly for failed deliveries.
_BULK_EVENT_LIST_KEYS = frozenset({"enriched_events", "events", "mapped_event_samples", "raw_response"})


def build_delivery_log_payload_sample(payload: dict[str, Any]) -> dict[str, Any]:
    """Return an isolated payload_sample without full event bodies, checkpoint bloat, or secrets."""

    if not isinstance(payload, dict):
        return {}

    out: dict[str, Any] = {}
    for key, value in payload.items():
        if key in _CHECKPOINT_KEYS:
            out[key] = slim_checkpoint_for_log(value) if isinstance(value, dict) else value
            continue
        if key == "replay_events" and isinstance(value, list):
            out[key] = copy_events([item for item in value if isinstance(item, dict)])
            continue
        if key in _BULK_EVENT_LIST_KEYS:
            continue
        if key in _REPLAY_EVENT_KEYS and key != "replay_events":
            continue
        out[key] = copy_json_value(value)
    # Never persist Authorization / API keys / tokens / passwords in delivery_logs.
    masked = mask_secrets_and_pem(out)
    return masked if isinstance(masked, dict) else {}
