"""Password hashing and JWT helpers."""

from __future__ import annotations

import bcrypt

from app.auth.jwt_service import (
    AuthTokenError,
    TOKEN_TYPE_ACCESS,
    TOKEN_TYPE_REFRESH,
    TokenClaims,
    decode_token,
    issue_access_token,
    issue_refresh_token,
)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against a bcrypt hash."""

    if not hashed_password:
        return False
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8"),
        )
    except (ValueError, TypeError):
        return False


def get_password_hash(password: str) -> str:
    """Return a bcrypt hash for storing ``platform_users.password_hash``."""

    digest = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())
    return digest.decode("utf-8")


__all__ = [
    "AuthTokenError",
    "TOKEN_TYPE_ACCESS",
    "TOKEN_TYPE_REFRESH",
    "TokenClaims",
    "decode_token",
    "get_password_hash",
    "issue_access_token",
    "issue_refresh_token",
    "verify_password",
]
