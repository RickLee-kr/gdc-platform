"""Destination adapters (plugin-style) for delivery."""

from __future__ import annotations

from app.destinations.adapters.base import DestinationAdapter
from app.destinations.adapters.registry import DestinationAdapterRegistry
from app.destinations.adapters.syslog_tcp import SyslogTcpDestinationAdapter
from app.destinations.adapters.syslog_udp import SyslogUdpDestinationAdapter
from app.destinations.adapters.webhook_post import WebhookPostDestinationAdapter

__all__ = [
    "DestinationAdapter",
    "DestinationAdapterRegistry",
    "SyslogUdpDestinationAdapter",
    "SyslogTcpDestinationAdapter",
    "WebhookPostDestinationAdapter",
]
