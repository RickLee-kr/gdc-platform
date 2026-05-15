"""Source adapter interface — one implementation per ``source_type``."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class SourceAdapter(ABC):
    """Fetches raw payload for event extraction (HTTP, DB, webhook ingest, ...)."""

    @abstractmethod
    def fetch(
        self,
        source_config: dict[str, Any],
        stream_config: dict[str, Any],
        checkpoint: dict[str, Any] | None,
    ) -> Any:
        """Return raw response (e.g. parsed JSON dict for HTTP API polling)."""
