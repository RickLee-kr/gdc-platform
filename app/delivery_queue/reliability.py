"""Per-stream reliability mode resolution for Durable Delivery Queue.

Enablement uses existing ``streams.config_json.reliability_mode`` (spec 048 /
audit design §Q13). Default remains ``DIRECT`` — zero behavior change when unset.

Phase 2: WEBHOOK_POST on PERSISTENT_QUEUE streams.
Phase 4: SYSLOG_TCP added — same shared queue lifecycle (no parallel engine).
"""

from __future__ import annotations

from typing import Any

RELIABILITY_MODE_DIRECT = "DIRECT"
RELIABILITY_MODE_PERSISTENT_QUEUE = "PERSISTENT_QUEUE"

_KNOWN_MODES = frozenset(
    {
        RELIABILITY_MODE_DIRECT,
        "MEMORY_BUFFER",
        RELIABILITY_MODE_PERSISTENT_QUEUE,
        "EXTERNAL_BUFFER",
    }
)

# Destinations that reuse the shared StreamDeliveryQueueItem lifecycle when
# reliability_mode=PERSISTENT_QUEUE. Expand one type per phase — do not enable
# SYSLOG_UDP / SYSLOG_TLS / AI_PROVIDER_POST here without a dedicated phase.
DURABLE_QUEUE_DESTINATION_TYPES = frozenset(
    {
        "WEBHOOK_POST",
        "SYSLOG_TCP",
    }
)


def _get(data: Any, key: str, default: Any = None) -> Any:
    if isinstance(data, dict):
        return data.get(key, default)
    return getattr(data, key, default)


def resolve_reliability_mode(stream: Any) -> str:
    """Return normalized reliability mode for a runtime stream dict or ORM-like object."""

    stream_config = _get(stream, "stream_config", None)
    if not isinstance(stream_config, dict):
        stream_config = _get(stream, "config_json", None)
    if not isinstance(stream_config, dict):
        stream_config = {}
    raw = stream_config.get("reliability_mode")
    if raw is None or str(raw).strip() == "":
        return RELIABILITY_MODE_DIRECT
    mode = str(raw).strip().upper()
    if mode not in _KNOWN_MODES:
        return RELIABILITY_MODE_DIRECT
    return mode


def is_persistent_queue_enabled(stream: Any) -> bool:
    return resolve_reliability_mode(stream) == RELIABILITY_MODE_PERSISTENT_QUEUE


def is_webhook_destination_type(destination_type: str | None) -> bool:
    return str(destination_type or "").strip().upper() == "WEBHOOK_POST"


def is_syslog_tcp_destination_type(destination_type: str | None) -> bool:
    return str(destination_type or "").strip().upper() == "SYSLOG_TCP"


def is_durable_queue_destination_type(destination_type: str | None) -> bool:
    return str(destination_type or "").strip().upper() in DURABLE_QUEUE_DESTINATION_TYPES


def uses_durable_destination_queue(stream: Any, destination_type: str | None) -> bool:
    """True when this stream+destination should use the shared PERSISTENT_QUEUE path."""

    return is_persistent_queue_enabled(stream) and is_durable_queue_destination_type(destination_type)


def uses_durable_webhook_queue(stream: Any, destination_type: str | None) -> bool:
    """Compatibility alias — prefer :func:`uses_durable_destination_queue`."""

    return uses_durable_destination_queue(stream, destination_type)
