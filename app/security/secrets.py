"""Secret masking helpers for API responses, exports, audit, and error sanitization."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit, urlunsplit
import re

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
        # Storage / API aliases used across connectors and destinations.
        "shared_secret",
        "db_password",
        "remote_password",
        "remote_private_key",
        "remote_private_key_passphrase",
        "private_key_passphrase",
        "webhook_shared_secret",
        "webhook_bearer_token",
        "connection_string",
        "database_url",
        "jdbc_url",
        "authorization",
        "cookie",
    }
)

# Nested header maps that may carry Authorization / API keys.
HEADER_MAP_FIELD_NAMES: frozenset[str] = frozenset(
    {
        "headers",
        "common_headers",
        "preflight_headers",
        "login_headers",
        "token_custom_headers",
        "extra_headers",
    }
)

# String fields that may embed credentials in URL userinfo.
URL_CREDENTIAL_FIELD_NAMES: frozenset[str] = frozenset(
    {
        "connection_string",
        "database_url",
        "jdbc_url",
        "url",
        "endpoint_url",
        "base_url",
        "host",
        "webhook_url",
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

SECRET_MASK = "********"
_MASK = SECRET_MASK


def is_secret_mask(value: Any) -> bool:
    """Return True when ``value`` is the standard secret placeholder."""

    return value is not None and str(value) == _MASK


def mask_credential_url(url: str) -> str:
    """Strip or mask username/password from a URL (or connection string)."""

    raw = str(url or "")
    if not raw:
        return raw
    try:
        parts = urlsplit(raw)
    except Exception:
        return raw
    if not parts.scheme or not parts.netloc:
        return raw
    # netloc may be user:pass@host:port
    if "@" not in parts.netloc:
        return raw
    userinfo, _, hostport = parts.netloc.rpartition("@")
    if not hostport:
        return raw
    if ":" in userinfo:
        user, _, _pw = userinfo.partition(":")
        netloc = f"{user}:{_MASK}@{hostport}" if user else f"{_MASK}@{hostport}"
    else:
        netloc = f"{_MASK}@{hostport}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


_CREDENTIAL_URL_IN_TEXT = re.compile(
    r"(?P<scheme>[a-zA-Z][a-zA-Z0-9+.-]*)://(?P<user>[^/@:\s]+):(?P<password>[^/@\s]+)@(?P<host>[^\s/]+)"
)


def mask_credential_urls_in_text(text: str) -> str:
    """Mask userinfo credentials in free-text that embeds URLs."""

    raw = str(text or "")
    if not raw or "://" not in raw or "@" not in raw:
        return raw

    def _repl(match: Any) -> str:
        return f"{match.group('scheme')}://{match.group('user')}:{_MASK}@{match.group('host')}"

    return _CREDENTIAL_URL_IN_TEXT.sub(_repl, raw)



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
    """Recursively mask known secret fields, header maps, and credential URLs."""

    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            key_str = str(key).lower()
            if key_str in SENSITIVE_FIELD_NAMES:
                out[key] = _MASK if item not in (None, "") else item
                continue
            if key_str in HEADER_MAP_FIELD_NAMES and isinstance(item, dict):
                try:
                    out[key] = mask_http_headers({str(k): str(v) for k, v in item.items()})
                except Exception:
                    out[key] = mask_secrets(item)
                continue
            if key_str in URL_CREDENTIAL_FIELD_NAMES and isinstance(item, str):
                out[key] = mask_credential_url(item)
                continue
            out[key] = mask_secrets(item)
        return out
    if isinstance(value, list):
        return [mask_secrets(item) for item in value]
    if isinstance(value, str) and "://" in value and "@" in value:
        return mask_credential_urls_in_text(mask_credential_url(value))
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


def merge_preserving_masked_secrets(
    incoming: dict[str, Any] | None,
    existing: dict[str, Any] | None,
) -> dict[str, Any]:
    """Deep-merge dicts, keeping existing secrets when the client sends the mask or empty."""

    src = dict(incoming or {})
    prev = dict(existing or {})
    out: dict[str, Any] = {}

    for key, item in src.items():
        key_str = str(key).lower()
        if key_str in SENSITIVE_FIELD_NAMES:
            if item in (None, "") or is_secret_mask(item):
                if key in prev and prev[key] not in (None, ""):
                    out[key] = prev[key]
                else:
                    out[key] = item
            else:
                out[key] = item
            continue
        if key_str in HEADER_MAP_FIELD_NAMES and isinstance(item, dict):
            prev_headers = prev.get(key) if isinstance(prev.get(key), dict) else {}
            merged_headers: dict[str, Any] = {}
            for hk, hv in item.items():
                if hv in (None, "") or is_secret_mask(hv):
                    if hk in prev_headers and prev_headers[hk] not in (None, ""):
                        merged_headers[hk] = prev_headers[hk]
                    else:
                        merged_headers[hk] = hv
                else:
                    merged_headers[hk] = hv
            out[key] = merged_headers
            continue
        if isinstance(item, dict) and isinstance(prev.get(key), dict):
            out[key] = merge_preserving_masked_secrets(item, prev.get(key))
            continue
        out[key] = item

    return out


def sanitize_error_detail(detail: Any) -> Any:
    """Sanitize API error details so request bodies / credentials are not echoed."""

    if isinstance(detail, str):
        masked = mask_credential_urls_in_text(mask_credential_url(detail))
        # Also strip PEM blocks from free-text errors.
        return redact_pem_literals(masked)
    if isinstance(detail, dict):
        out: dict[str, Any] = {}
        for key, item in detail.items():
            out[key] = sanitize_error_detail(item)
        return mask_secrets_and_pem(out)
    if isinstance(detail, list):
        return [sanitize_error_detail(item) for item in detail]
    return detail


def secret_fields_changed(
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
) -> list[str]:
    """Return sensitive field names whose values changed (for audit metadata)."""

    prev = dict(before or {})
    nxt = dict(after or {})
    changed: list[str] = []

    def _walk(prefix: str, a: Any, b: Any) -> None:
        if isinstance(a, dict) or isinstance(b, dict):
            ad = a if isinstance(a, dict) else {}
            bd = b if isinstance(b, dict) else {}
            for k in set(ad) | set(bd):
                key_str = str(k).lower()
                path = f"{prefix}.{k}" if prefix else str(k)
                if key_str in SENSITIVE_FIELD_NAMES or key_str in HEADER_MAP_FIELD_NAMES:
                    if ad.get(k) != bd.get(k):
                        changed.append(path)
                    continue
                _walk(path, ad.get(k), bd.get(k))
            return
        if a != b and prefix:
            leaf = prefix.rsplit(".", 1)[-1].lower()
            if leaf in SENSITIVE_FIELD_NAMES:
                changed.append(prefix)

    _walk("", prev, nxt)
    # Deduplicate while preserving order.
    seen: set[str] = set()
    out: list[str] = []
    for name in changed:
        if name not in seen:
            seen.add(name)
            out.append(name)
    return out
