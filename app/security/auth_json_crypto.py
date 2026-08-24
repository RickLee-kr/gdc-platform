"""Encrypt/decrypt sensitive fields inside auth_json (and similar) dicts.

Reuses :func:`app.security.secrets.is_sensitive_field_name` so encryption
targets match API masking / secret-key detection.
"""

from __future__ import annotations

from typing import Any

from app.security.encryption import (
    EncryptionError,
    decrypt_string,
    encrypt_string,
    is_encrypted_envelope,
)
from app.security.secrets import is_secret_mask, is_sensitive_field_name


def encrypt_secret_fields(value: Any, *, raw_key: str | None = None) -> Any:
    """Return a deep copy with sensitive plaintext strings replaced by envelopes.

    - Already-encrypted envelopes are left unchanged (idempotent).
    - Empty / null / mask placeholders are left unchanged.
    - Non-secret keys are walked recursively but not encrypted at the key itself.
    - Encryption failure raises (never silently stores plaintext).
    """

    if isinstance(value, dict):
        if is_encrypted_envelope(value):
            return dict(value)
        out: dict[str, Any] = {}
        for key, item in value.items():
            if is_sensitive_field_name(key):
                out[key] = _encrypt_sensitive_value(item, raw_key=raw_key)
            else:
                out[key] = encrypt_secret_fields(item, raw_key=raw_key)
        return out
    if isinstance(value, list):
        return [encrypt_secret_fields(item, raw_key=raw_key) for item in value]
    return value


def decrypt_secret_fields(value: Any, *, raw_key: str | None = None) -> Any:
    """Return a deep copy with envelopes decrypted to plaintext strings.

    Plaintext legacy values pass through unchanged (backward compatible).
    Missing/wrong key or tampered ciphertext raises (fail closed).
    """

    if isinstance(value, dict):
        if is_encrypted_envelope(value):
            return decrypt_string(value, raw_key=raw_key)
        out: dict[str, Any] = {}
        for key, item in value.items():
            if is_sensitive_field_name(key):
                out[key] = _decrypt_sensitive_value(item, raw_key=raw_key)
            else:
                out[key] = decrypt_secret_fields(item, raw_key=raw_key)
        return out
    if isinstance(value, list):
        return [decrypt_secret_fields(item, raw_key=raw_key) for item in value]
    return value


def auth_json_for_storage(auth_json: dict[str, Any] | None, *, raw_key: str | None = None) -> dict[str, Any]:
    """Encrypt sensitive fields for DB persistence."""

    return encrypt_secret_fields(dict(auth_json or {}), raw_key=raw_key)


def auth_json_for_runtime(auth_json: dict[str, Any] | None, *, raw_key: str | None = None) -> dict[str, Any]:
    """Decrypt sensitive fields for runtime auth use."""

    return decrypt_secret_fields(dict(auth_json or {}), raw_key=raw_key)


def contains_plaintext_secrets(value: Any) -> bool:
    """True when any sensitive field still holds a non-empty plaintext string."""

    if isinstance(value, dict):
        if is_encrypted_envelope(value):
            return False
        for key, item in value.items():
            if is_sensitive_field_name(key):
                if isinstance(item, str) and item.strip() and not is_secret_mask(item):
                    return True
                if isinstance(item, (dict, list)) and not is_encrypted_envelope(item):
                    if contains_plaintext_secrets(item):
                        return True
            elif contains_plaintext_secrets(item):
                return True
        return False
    if isinstance(value, list):
        return any(contains_plaintext_secrets(item) for item in value)
    return False


def contains_encrypted_secrets(value: Any) -> bool:
    """True when any encrypted envelope is present."""

    if is_encrypted_envelope(value):
        return True
    if isinstance(value, dict):
        return any(contains_encrypted_secrets(item) for item in value.values())
    if isinstance(value, list):
        return any(contains_encrypted_secrets(item) for item in value)
    return False


def _encrypt_sensitive_value(item: Any, *, raw_key: str | None) -> Any:
    if item is None or item == "":
        return item
    if is_secret_mask(item):
        return item
    if is_encrypted_envelope(item):
        return dict(item)
    if isinstance(item, str):
        return encrypt_string(item, raw_key=raw_key)
    if isinstance(item, dict):
        # Nested object under a sensitive key (unusual); encrypt string leaves.
        return encrypt_secret_fields(item, raw_key=raw_key)
    if isinstance(item, list):
        return encrypt_secret_fields(item, raw_key=raw_key)
    # Non-string secrets (bool/number) are not encrypted; leave as-is.
    return item


def _decrypt_sensitive_value(item: Any, *, raw_key: str | None) -> Any:
    if item is None or item == "":
        return item
    if is_encrypted_envelope(item):
        return decrypt_string(item, raw_key=raw_key)
    if isinstance(item, dict):
        return decrypt_secret_fields(item, raw_key=raw_key)
    if isinstance(item, list):
        return decrypt_secret_fields(item, raw_key=raw_key)
    return item


def assert_no_plaintext_secret_strings(value: Any, known_secrets: list[str]) -> None:
    """Raise ``EncryptionError`` if any known secret substring appears as plaintext JSON text."""

    blob = _jsonish_dump(value)
    for secret in known_secrets:
        if secret and secret in blob:
            raise EncryptionError("plaintext secret material found where ciphertext expected")


def _jsonish_dump(value: Any) -> str:
    if isinstance(value, dict):
        parts = []
        for k, v in value.items():
            parts.append(str(k))
            parts.append(_jsonish_dump(v))
        return "|".join(parts)
    if isinstance(value, list):
        return "|".join(_jsonish_dump(v) for v in value)
    if isinstance(value, str):
        return value
    return ""
