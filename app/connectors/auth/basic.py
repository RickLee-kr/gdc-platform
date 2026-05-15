"""HTTP Basic authentication strategy."""

from __future__ import annotations

import base64
from typing import Any

from app.connectors.auth.base import AuthStrategy


class BasicAuthStrategy(AuthStrategy):
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
        username = str(auth.get("username") or "")
        password = str(auth.get("password") or "")
        token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
        headers.setdefault("Authorization", f"Basic {token}")
        return headers, params
