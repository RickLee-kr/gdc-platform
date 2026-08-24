"""Application-level authenticated encryption for credential secrets at rest.

Uses AES-256-GCM via the ``cryptography`` library (already pulled in by
``python-jose[cryptography]``). Does not implement custom crypto primitives.

Envelope (JSON object replacing a plaintext secret string)::

    {
      "__gdc_enc__": 1,
      "alg": "AESGCM",
      "kid": "1",
      "n": "<urlsafe-b64 nonce>",
      "ct": "<urlsafe-b64 ciphertext||tag>"
    }

``kid`` is a key-version identifier so future rotation can select material
without redesigning the envelope. Automatic rotation is out of scope.
"""

from __future__ import annotations

import base64
import hashlib
import os
from functools import lru_cache
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes

from app.production_security import KNOWN_INSECURE_SECRETS, MIN_PRODUCTION_SECRET_LENGTH

ENVELOPE_MARKER = "__gdc_enc__"
ENVELOPE_VERSION = 1
ENVELOPE_ALG = "AESGCM"
DEFAULT_KEY_ID = "1"

_HKDF_SALT = b"gdc-platform-credential-at-rest-v1"
_HKDF_INFO = b"auth-json-aesgcm-v1"
_NONCE_SIZE = 12  # AES-GCM standard nonce length


class EncryptionError(ValueError):
    """Raised when encryption/decryption fails closed (tamper, wrong key, etc.)."""


class EncryptionKeyError(EncryptionError):
    """Raised when ENCRYPTION_KEY is missing, placeholder, or otherwise unusable."""


def is_encrypted_envelope(value: Any) -> bool:
    """True when ``value`` is a versioned ciphertext envelope dict."""

    if not isinstance(value, dict):
        return False
    marker = value.get(ENVELOPE_MARKER)
    if marker is None:
        return False
    try:
        version = int(marker)
    except (TypeError, ValueError):
        return False
    if version < 1:
        return False
    return (
        str(value.get("alg") or "") == ENVELOPE_ALG
        and isinstance(value.get("n"), str)
        and isinstance(value.get("ct"), str)
        and str(value.get("n") or "").strip() != ""
        and str(value.get("ct") or "").strip() != ""
    )


def encryption_key_is_usable(raw_key: str | None) -> str | None:
    """Return a reason string when the key must not be used; else ``None``."""

    raw = "" if raw_key is None else str(raw_key)
    stripped = raw.strip()
    if not stripped:
        return "empty"
    if stripped.casefold() in KNOWN_INSECURE_SECRETS:
        return "known placeholder or development default"
    if len(stripped) < MIN_PRODUCTION_SECRET_LENGTH:
        return f"shorter than {MIN_PRODUCTION_SECRET_LENGTH} characters"
    return None


def require_usable_encryption_key(raw_key: str | None) -> str:
    """Return stripped key or raise ``EncryptionKeyError`` (fail closed)."""

    reason = encryption_key_is_usable(raw_key)
    if reason:
        raise EncryptionKeyError(
            f"ENCRYPTION_KEY is {reason}; refusing crypto operation "
            "(no plaintext fallback)"
        )
    return str(raw_key).strip()


def _b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64d(text: str) -> bytes:
    padded = text + "=" * (-len(text) % 4)
    try:
        return base64.urlsafe_b64decode(padded.encode("ascii"))
    except (ValueError, TypeError) as exc:
        raise EncryptionError("invalid encryption envelope encoding") from exc


def derive_aes_key(raw_key: str, *, kid: str = DEFAULT_KEY_ID) -> bytes:
    """Derive a 32-byte AES key from ENCRYPTION_KEY via HKDF-SHA256."""

    key_material = require_usable_encryption_key(raw_key).encode("utf-8")
    info = _HKDF_INFO + b"|kid=" + str(kid or DEFAULT_KEY_ID).encode("utf-8")
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_HKDF_SALT,
        info=info,
    ).derive(key_material)


@lru_cache(maxsize=8)
def _cached_aesgcm(raw_key: str, kid: str) -> AESGCM:
    return AESGCM(derive_aes_key(raw_key, kid=kid))


def clear_encryption_key_cache() -> None:
    """Drop cached AESGCM instances (tests / key rotation)."""

    _cached_aesgcm.cache_clear()


def current_encryption_key() -> str:
    """Read ``settings.ENCRYPTION_KEY`` (validated)."""

    from app.config import settings

    return require_usable_encryption_key(getattr(settings, "ENCRYPTION_KEY", None))


def current_key_id() -> str:
    from app.config import settings

    kid = str(getattr(settings, "ENCRYPTION_KEY_ID", None) or DEFAULT_KEY_ID).strip()
    return kid or DEFAULT_KEY_ID


def encrypt_string(plaintext: str, *, raw_key: str | None = None, kid: str | None = None) -> dict[str, Any]:
    """Encrypt a UTF-8 string into a versioned envelope dict."""

    if plaintext is None:
        raise EncryptionError("cannot encrypt None")
    text = str(plaintext)
    key = require_usable_encryption_key(raw_key if raw_key is not None else current_encryption_key())
    key_id = str(kid or current_key_id()).strip() or DEFAULT_KEY_ID
    aesgcm = _cached_aesgcm(key, key_id)
    nonce = os.urandom(_NONCE_SIZE)
    # AAD binds version + kid so envelope metadata cannot be swapped silently.
    aad = f"gdc-enc-v{ENVELOPE_VERSION}|{key_id}|{ENVELOPE_ALG}".encode("utf-8")
    ct = aesgcm.encrypt(nonce, text.encode("utf-8"), aad)
    return {
        ENVELOPE_MARKER: ENVELOPE_VERSION,
        "alg": ENVELOPE_ALG,
        "kid": key_id,
        "n": _b64e(nonce),
        "ct": _b64e(ct),
    }


def decrypt_string(envelope: Any, *, raw_key: str | None = None) -> str:
    """Decrypt an envelope to a UTF-8 string. Fail closed on tamper / wrong key."""

    if not is_encrypted_envelope(envelope):
        raise EncryptionError("value is not a credential encryption envelope")
    assert isinstance(envelope, dict)
    version = int(envelope[ENVELOPE_MARKER])
    if version != ENVELOPE_VERSION:
        raise EncryptionError(f"unsupported encryption envelope version: {version}")
    key_id = str(envelope.get("kid") or DEFAULT_KEY_ID).strip() or DEFAULT_KEY_ID
    key = require_usable_encryption_key(raw_key if raw_key is not None else current_encryption_key())
    aesgcm = _cached_aesgcm(key, key_id)
    nonce = _b64d(str(envelope["n"]))
    ct = _b64d(str(envelope["ct"]))
    aad = f"gdc-enc-v{version}|{key_id}|{ENVELOPE_ALG}".encode("utf-8")
    try:
        pt = aesgcm.decrypt(nonce, ct, aad)
    except InvalidTag as exc:
        raise EncryptionError(
            "credential decryption failed (wrong key or tampered ciphertext)"
        ) from exc
    return pt.decode("utf-8")


def fingerprint_key(raw_key: str | None) -> str:
    """Non-secret short fingerprint for diagnostics (never log the raw key)."""

    usable = require_usable_encryption_key(raw_key)
    return hashlib.sha256(usable.encode("utf-8")).hexdigest()[:12]
