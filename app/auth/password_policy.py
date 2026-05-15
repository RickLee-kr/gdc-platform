"""Shared rules for operator platform user passwords (English messages only)."""

from __future__ import annotations

_FORBIDDEN_PLAINTEXT = "admin"


def validate_new_platform_password(value: str) -> None:
    """Raise ``ValueError`` with an English message when ``value`` is not acceptable."""

    s = (value or "").strip()
    if len(s) < 8:
        raise ValueError("Password must be at least 8 characters.")
    if len(s) > 256:
        raise ValueError("Password must be at most 256 characters.")
    if s.lower() == _FORBIDDEN_PLAINTEXT:
        raise ValueError('The password "admin" is not allowed. Choose a stronger password.')
