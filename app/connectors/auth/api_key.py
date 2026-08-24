"""API key in header or query string."""

from __future__ import annotations

from typing import Any

from app.connectors.auth.base import AuthStrategy
from app.runtime.errors import PreviewRequestError
from app.security.encryption import is_encrypted_envelope


class ApiKeyAuthStrategy(AuthStrategy):
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
        name = str(auth.get("api_key_name") or "")
        value = auth.get("api_key_value")
        if is_encrypted_envelope(value) or (
            isinstance(value, str) and "__gdc_enc__" in value and "AESGCM" in value
        ):
            raise PreviewRequestError(
                500,
                {
                    "code": "AUTH_SECRET_NOT_DECRYPTED",
                    "message": "api key is still encrypted; decrypt before apply",
                },
            )
        location = str(auth.get("api_key_location") or "headers").lower()
        if name and value is not None:
            if location in {"query", "query_param", "query_params"}:
                params.setdefault(name, value)
            else:
                headers.setdefault(name, str(value))
        return headers, params
