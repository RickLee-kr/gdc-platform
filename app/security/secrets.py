"""Secret masking helpers for API responses."""

from __future__ import annotations

from typing import Any

# Exported for export/import integrity checks (backup bundles, audit views).
SENSITIVE_FIELD_NAMES: frozenset[str] = frozenset(
    {
    "secret_key",
    "access_key",
    "password",
    "basic_password",
    "token",
    "bearer_token",
    "api_key_value",
    "client_secret",
    "oauth_client_secret",
    "oauth2_client_secret",
    "login_password",
    "refresh_token",
    "access_token",
    "id_token",
    "api_key",
    "secret",
    "private_key",
    "tls_key_pem",
    "certificate_pem",
    }
)

_SENSITIVE_HEADER_NAMES = frozenset(
    {
        "authorization",
        "cookie",
        "set-cookie",
        "x-api-key",
    }
)

_MASK = "********"


def mask_http_headers(headers: dict[str, str]) -> dict[str, str]:
    """Mask Authorization, Cookie, API keys, and similar headers for API responses."""

    out: dict[str, str] = {}
    for key, item in headers.items():
        lk = str(key).lower()
        if lk in _SENSITIVE_HEADER_NAMES:
            out[str(key)] = _MASK if item not in (None, "") else str(item)
            continue
        low_key = lk.replace("_", "-")
        if "secret" in lk:
            out[str(key)] = _MASK if item not in (None, "") else str(item)
            continue
        if low_key.endswith("-token") or "token" in lk or "password" in lk:
            out[str(key)] = _MASK if item not in (None, "") else str(item)
            continue
        if "api-key" in low_key or low_key.endswith("apikey") or "api_key" in lk:
            out[str(key)] = _MASK if item not in (None, "") else str(item)
            continue
        out[str(key)] = str(item)
    return out


def mask_secrets(value: Any) -> Any:
    """Recursively mask known secret fields in dict/list payloads."""

    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            key_str = str(key).lower()
            if key_str in SENSITIVE_FIELD_NAMES:
                out[key] = _MASK if item not in (None, "") else item
                continue
            out[key] = mask_secrets(item)
        return out
    if isinstance(value, list):
        return [mask_secrets(item) for item in value]
    return value


def redact_pem_literals(value: Any) -> Any:
    """Replace string values that contain PEM blocks (certs/keys) with the standard mask."""

    if isinstance(value, str):
        if "-----BEGIN" in value and "-----END" in value:
            return _MASK
        return value
    if isinstance(value, dict):
        return {k: redact_pem_literals(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact_pem_literals(item) for item in value]
    return value


def mask_secrets_and_pem(value: Any) -> Any:
    """Apply :func:`mask_secrets` then strip PEM material from any remaining strings."""

    return redact_pem_literals(mask_secrets(value))
