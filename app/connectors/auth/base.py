"""Auth strategy interface for HTTP outbound requests (runtime poller + previews)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class AuthStrategy(ABC):
    """Prepares headers/params for the resource request (session login may run separately)."""

    @abstractmethod
    def apply(
        self,
        auth: dict[str, Any],
        headers: dict[str, str],
        params: dict[str, Any],
        *,
        verify_ssl: bool,
        proxy_url: str | None,
        timeout_seconds: float,
        base_url: str,
    ) -> tuple[dict[str, str], dict[str, Any]]:
        """Return updated headers and query params."""
