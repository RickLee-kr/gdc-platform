"""HTTP API polling source adapter — wraps :class:`HttpPoller`."""

from __future__ import annotations

from typing import Any

from app.pollers.http_poller import HttpPoller
from app.sources.adapters.base import SourceAdapter


class HttpApiSourceAdapter(SourceAdapter):
    def __init__(self, poller: HttpPoller | None = None) -> None:
        self._poller = poller or HttpPoller()

    def fetch(
        self,
        source_config: dict[str, Any],
        stream_config: dict[str, Any],
        checkpoint: dict[str, Any] | None,
    ) -> Any:
        return self._poller.fetch(source_config, stream_config, checkpoint)
