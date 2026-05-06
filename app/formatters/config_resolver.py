"""Resolve formatter_config: route override > destination formatter > flat keys."""

from __future__ import annotations

from typing import Any

_FORMATTER_TOP_KEYS = frozenset(
    {
        "message_format",
        "syslog",
        "facility",
        "severity",
        "hostname",
        "app_name",
        "tag",
    }
)


def resolve_formatter_config(
    destination_config: dict[str, Any],
    route_formatter_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Pick formatter settings for Preview parity with runtime delivery.

    Priority:
    1. Non-empty ``route_formatter_config`` → use as full formatter_config dict.
    2. Else ``destination_config["formatter_config"]`` if present.
    3. Else flat formatter-related keys on ``destination_config``.

    Empty route dict ``{}`` does not override — falls through to destination.
    """

    if route_formatter_config is not None and route_formatter_config:
        if not isinstance(route_formatter_config, dict):
            raise ValueError("route formatter_config must be an object")
        return dict(route_formatter_config)

    explicit = destination_config.get("formatter_config")
    if explicit is not None:
        if not isinstance(explicit, dict):
            raise ValueError("destination config formatter_config must be an object")
        return explicit

    return {k: destination_config[k] for k in _FORMATTER_TOP_KEYS if k in destination_config}
