"""Protection mode applicators (M6 — masking only)."""

from __future__ import annotations

import hashlib
import hmac
import re
from typing import Any

from sqlalchemy.orm import Session

from app.protection.models import (
    PROTECTION_MODE_FULL_MASK,
    PROTECTION_MODE_HASH,
    PROTECTION_MODE_PARTIAL_MASK,
    PROTECTION_MODE_TOKENIZATION,
)

_MASK_LITERAL = "********"
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PHONE_DIGITS_RE = re.compile(r"\d")


def apply_protection_mode(
    value: Any,
    mode: str,
    *,
    stream_id: int,
    hmac_key: bytes,
    db: Session | None = None,
    field_path: str | None = None,
    token_map: dict[tuple[str, str], str] | None = None,
) -> Any:
    if mode == PROTECTION_MODE_FULL_MASK:
        return full_mask_value(value)
    if mode == PROTECTION_MODE_PARTIAL_MASK:
        return partial_mask_value(value)
    if mode == PROTECTION_MODE_HASH:
        return hash_mask_value(value, stream_id=stream_id, hmac_key=hmac_key)
    if mode == PROTECTION_MODE_TOKENIZATION:
        from app.protection.identity_vault import tokenize_value

        if field_path is None:
            raise ValueError("field_path is required for tokenization")
        return tokenize_value(
            db,
            stream_id=stream_id,
            field_path=field_path,
            value=value,
            token_map=token_map,
        )
    raise ValueError(f"unsupported protection_mode: {mode!r}")


def full_mask_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        return _MASK_LITERAL
    if isinstance(value, bool):
        return False
    if isinstance(value, int) and not isinstance(value, bool):
        return None
    if isinstance(value, float):
        return None
    if isinstance(value, dict):
        return {}
    if isinstance(value, list):
        return []
    return _MASK_LITERAL


def partial_mask_value(value: Any) -> Any:
    if not isinstance(value, str):
        return full_mask_value(value)
    text = value.strip()
    if not text:
        return _MASK_LITERAL
    if "@" in text and _EMAIL_RE.match(text):
        return _partial_mask_email(text)
    digits = "".join(_PHONE_DIGITS_RE.findall(text))
    if len(digits) >= 7:
        return f"***{digits[-4:]}"
    if len(text) <= 4:
        return _MASK_LITERAL
    return f"*******{text[-4:]}"


def _partial_mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    if not local or not domain:
        return _MASK_LITERAL
    local_mask = f"{local[0]}***" if local else "***"
    parts = domain.split(".")
    if len(parts) < 2:
        return f"{local_mask}@{domain[0]}***"
    tld = parts[-1]
    first_label = parts[0]
    domain_mask = f"{first_label[0]}***.{tld}" if first_label else f"***.{tld}"
    return f"{local_mask}@{domain_mask}"


def hash_mask_value(value: Any, *, stream_id: int, hmac_key: bytes) -> Any:
    if not isinstance(value, str):
        return full_mask_value(value)
    msg = value.encode("utf-8")
    digest = hmac.new(hmac_key, msg, hashlib.sha256).hexdigest()
    return f"sha256:{digest}"
