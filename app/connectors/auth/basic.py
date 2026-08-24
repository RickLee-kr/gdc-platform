"""HTTP Basic authentication strategy."""

from __future__ import annotations

import base64
from typing import Any

from app.connectors.auth.base import AuthStrategy
from app.runtime.errors import PreviewRequestError
from app.security.encryption import is_encrypted_envelope


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
        username = auth.get("username")
        password = auth.get("password")
        if is_encrypted_envelope(username) or is_encrypted_envelope(password):
            raise PreviewRequestError(
                500,
                {
                    "code": "AUTH_SECRET_NOT_DECRYPTED",
                    "message": "basic credentials are still encrypted; decrypt before apply",
                },
            )
        user_s = str(username or "")
        pass_s = str(password or "")
        token = base64.b64encode(f"{user_s}:{pass_s}".encode("utf-8")).decode("ascii")
        headers.setdefault("Authorization", f"Basic {token}")
        return headers, params
