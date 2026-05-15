"""Destination adapter interface — one implementation per ``destination_type``."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from app.formatters.message_prefix import MessagePrefixResolveContext


class DestinationAdapter(ABC):
    """Sends formatted/enriched events to an external sink."""

    @abstractmethod
    def send(
        self,
        events: list[dict[str, Any]],
        destination_config: dict[str, Any],
        formatter_override: dict[str, Any] | None = None,
        *,
        prefix_context: MessagePrefixResolveContext | None = None,
    ) -> None:
        """Deliver events; raise :class:`DestinationSendError` on failure."""
