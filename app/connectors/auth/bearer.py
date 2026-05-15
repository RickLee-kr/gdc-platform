"""Static Bearer token authentication strategy."""

from __future__ import annotations

from typing import Any

from app.connectors.auth.base import AuthStrategy


class BearerAuthStrategy(AuthStrategy):
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
        bearer = str(auth.get("token") or "")
        if bearer:
            headers.setdefault("Authorization", f"Bearer {bearer}")
        return headers, params
