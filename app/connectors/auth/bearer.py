"""Static Bearer token authentication strategy."""

from __future__ import annotations

from typing import Any

from app.connectors.auth.base import AuthStrategy
from app.runtime.errors import PreviewRequestError
from app.security.encryption import is_encrypted_envelope


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
        raw = auth.get("token")
        # Fail closed: never stringify ciphertext envelopes onto the wire.
        if is_encrypted_envelope(raw) or (
            isinstance(raw, str) and "__gdc_enc__" in raw and "AESGCM" in raw
        ):
            raise PreviewRequestError(
                500,
                {
                    "code": "AUTH_SECRET_NOT_DECRYPTED",
                    "message": "bearer token is still encrypted; decrypt before apply",
                },
            )
        bearer = str(raw or "")
        if bearer:
            headers.setdefault("Authorization", f"Bearer {bearer}")
        return headers, params
