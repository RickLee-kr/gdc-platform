"""Password hashing and JWT helpers — implementation deferred."""

# TODO: Implement JWT encode/decode with SECRET_KEY and ACCESS_TOKEN_EXPIRE_MINUTES (master design §21).


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Placeholder: verify bcrypt hash."""

    return False


def get_password_hash(password: str) -> str:
    """Placeholder: bcrypt hash for admin password."""

    return ""


def create_access_token(subject: str) -> str:
    """Placeholder: issue JWT for successful login."""

    return ""
