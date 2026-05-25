"""Unified platform administrator password policy (bootstrap, seed, recovery).

Contract (constitution / specs/039):

- First install: create ``admin`` with fixed default ``admin`` or ``GDC_SEED_ADMIN_PASSWORD``.
- Repeated bootstrap/seed: create-only; never change an existing password hash.
- Explicit recovery: ``GDC_RECONCILE_ADMIN_PASSWORD=true`` (or CLI flags) with
  ``GDC_SEED_ADMIN_PASSWORD`` always applies the password hash — no silent skip.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.auth.security import get_password_hash, verify_password
from app.platform_admin.models import PlatformUser
from app.platform_admin.validation import normalize_username

ADMIN_USERNAME = "admin"
DEFAULT_BOOTSTRAP_PASSWORD = "admin"

RECONCILE_REASON_EXPLICIT_RESET = "explicit_reset"
RECONCILE_REASON_DISABLED = "disabled"
RECONCILE_REASON_PASSWORD_UNSET = "GDC_SEED_ADMIN_PASSWORD_unset"

ENV_SEED_PASSWORD = "GDC_SEED_ADMIN_PASSWORD"
ENV_RECONCILE_FLAG = "GDC_RECONCILE_ADMIN_PASSWORD"


def read_seed_password_from_env() -> str:
    env_pw = (os.environ.get(ENV_SEED_PASSWORD) or "").strip()
    if env_pw and len(env_pw) < 8:
        raise ValueError(f"{ENV_SEED_PASSWORD} must be at least 8 characters when set")
    return env_pw


def _env_truthy(name: str) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def read_reconcile_flag_from_env() -> bool | None:
    if ENV_RECONCILE_FLAG not in os.environ:
        return None
    if not (os.environ.get(ENV_RECONCILE_FLAG) or "").strip():
        return False
    return _env_truthy(ENV_RECONCILE_FLAG)


def resolve_reconcile_enabled(explicit: bool | None) -> bool:
    if explicit is not None:
        return bool(explicit)
    from_env = read_reconcile_flag_from_env()
    if from_env is not None:
        return from_env
    return False


def _apply_password_hash(user: PlatformUser, password: str) -> None:
    user.password_hash = get_password_hash(password)
    user.must_change_password = True
    user.token_version = int(getattr(user, "token_version", 1) or 1) + 1


def ensure_platform_admin(
    db: Session,
    *,
    reconcile_admin_password: bool | None = None,
    force_reset: bool = False,
) -> dict[str, Any]:
    """Create or update the platform ``admin`` user according to the shared policy."""

    username = normalize_username(ADMIN_USERNAME)
    explicit_reconcile = resolve_reconcile_enabled(reconcile_admin_password)
    env_pw = read_seed_password_from_env()
    existing = db.query(PlatformUser).filter(PlatformUser.username == username).first()

    if existing is not None:
        if force_reset or explicit_reconcile:
            if not env_pw:
                raise ValueError(
                    f"{ENV_SEED_PASSWORD} must be set (minimum 8 characters) when "
                    f"{ENV_RECONCILE_FLAG}=true or an explicit admin password reset is requested",
                )
            _apply_password_hash(existing, env_pw)
            db.commit()
            db.refresh(existing)
            return {
                "created": False,
                "username": username,
                "user_id": int(existing.id),
                "password_reconcile": True,
                "password_reconcile_reason": RECONCILE_REASON_EXPLICIT_RESET,
                "password_updated": True,
            }

        if not env_pw:
            return {
                "created": False,
                "username": username,
                "password_reconcile": False,
                "password_reconcile_reason": RECONCILE_REASON_PASSWORD_UNSET,
            }

        return {
            "created": False,
            "username": username,
            "password_reconcile": False,
            "password_reconcile_reason": RECONCILE_REASON_DISABLED,
        }

    if env_pw:
        password = env_pw
        password_source = ENV_SEED_PASSWORD
    else:
        password = DEFAULT_BOOTSTRAP_PASSWORD
        password_source = "first_install_default"

    user = PlatformUser(
        username=username,
        password_hash=get_password_hash(password),
        role="ADMINISTRATOR",
        status="ACTIVE",
        must_change_password=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {
        "created": True,
        "username": username,
        "user_id": int(user.id),
        "password_source": password_source,
    }


def verify_platform_admin_password(db: Session, password: str, *, username: str = ADMIN_USERNAME) -> bool:
    row = db.query(PlatformUser).filter(PlatformUser.username == normalize_username(username)).first()
    if row is None:
        return False
    return verify_password(password, str(row.password_hash or ""))


def format_admin_reset_report(admin_result: dict[str, Any]) -> str:
    """Human-readable summary for operators (reset script / seed CLI)."""

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    created = admin_result.get("created") is True
    admin_found = not created
    password_updated = admin_result.get("password_reconcile") is True or created
    reconcile_mode = admin_result.get("password_reconcile_reason") or (
        "created" if created else RECONCILE_REASON_DISABLED
    )
    lines = [
        "[admin-reset]",
        f"admin found: {str(bool(admin_found or admin_result.get('created') is False)).lower()}",
        f"password updated: {str(bool(password_updated)).lower()}",
        f"reconcile mode: {reconcile_mode}",
        "operational data preserved: true",
        f"username: {admin_result.get('username', ADMIN_USERNAME)}",
        f"timestamp: {now}",
    ]
    return "\n".join(lines)
