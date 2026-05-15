"""Auth HTTP routes — local platform_users login + JWT session (spec 020).

Replaces the spec 019 ``X-GDC-Role`` header trust with a real JWT login.
Tokens are signed HS256 with ``settings.JWT_SECRET_KEY``.  Access tokens are
short-lived; refresh tokens last longer (24 h by default).  Invalidation is
achieved by bumping ``platform_users.token_version`` (no DB revocation list).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, ValidationInfo, field_validator
from sqlalchemy.orm import Session

from app.auth.password_policy import validate_new_platform_password
from app.auth.jwt_service import (
    AuthTokenError,
    TOKEN_TYPE_ACCESS,
    TOKEN_TYPE_REFRESH,
    TokenClaims,
    decode_token,
    issue_access_token,
    issue_refresh_token,
)
from app.auth.route_access import build_capabilities
from app.auth.role_guard import (
    KNOWN_ROLES,
    ROLE_ADMINISTRATOR,
    resolve_auth_context,
)
from app.auth.security import get_password_hash, verify_password
from app.config import settings
from app.database import get_db
from app.platform_admin import journal
from app.platform_admin.repository import get_user_by_id, get_user_by_username

logger = logging.getLogger(__name__)

router = APIRouter()


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)


class SessionUser(BaseModel):
    username: str
    role: str
    status: str
    must_change_password: bool = False
    capabilities: dict[str, bool] = Field(default_factory=dict)


class TokenBundle(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    expires_at: str
    user: SessionUser


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=10)


class LogoutRequest(BaseModel):
    revoke_all: bool = False


class WhoAmIResponse(BaseModel):
    username: str
    role: str
    authenticated: bool
    must_change_password: bool = False
    token_expires_at: str | None = None
    capabilities: dict[str, bool] = Field(default_factory=dict)


class SelfPasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)
    confirm_new_password: str = Field(min_length=1, max_length=256)

    @field_validator("confirm_new_password")
    @classmethod
    def _new_passwords_match(cls, v: str, info: ValidationInfo) -> str:
        if info.data.get("new_password") != v:
            raise ValueError("new_password and confirm_new_password do not match")
        return v


class SelfPasswordChangeResponse(BaseModel):
    ok: bool = True
    message: str = "Password updated. Please sign in again."


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_role(raw: str | None) -> str:
    v = (raw or "").strip().upper()
    return v if v in KNOWN_ROLES else ROLE_ADMINISTRATOR


def _build_token_bundle(
    *,
    user_id: int,
    username: str,
    role: str,
    token_version: int,
    user_status: str,
    must_change_password: bool,
) -> TokenBundle:
    access, access_exp = issue_access_token(
        username=username,
        user_id=user_id,
        role=role,
        token_version=token_version,
        must_change_password=must_change_password,
    )
    refresh, _refresh_exp = issue_refresh_token(
        username=username,
        user_id=user_id,
        role=role,
        token_version=token_version,
        must_change_password=must_change_password,
    )
    expires_in = max(1, int((access_exp - _utcnow()).total_seconds()))
    return TokenBundle(
        access_token=access,
        refresh_token=refresh,
        token_type="bearer",
        expires_in=expires_in,
        expires_at=access_exp.isoformat(),
        user=SessionUser(
            username=username,
            role=role,
            status=user_status,
            must_change_password=must_change_password,
            capabilities=build_capabilities(role),
        ),
    )


def _auth_error(code: str, message: str, http_status: int = status.HTTP_401_UNAUTHORIZED) -> HTTPException:
    return HTTPException(
        status_code=http_status,
        detail={"error_code": code, "message": message},
        headers={"WWW-Authenticate": "Bearer"},
    )


@router.post("/login", response_model=TokenBundle)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenBundle:
    """Verify credentials and return an access + refresh JWT pair.

    On failure we always return ``USER_AUTH_FAILED`` with HTTP 400 so the
    client cannot tell whether the username exists.  Successful logins record
    a ``USER_LOGIN`` audit event and update ``last_login_at``.
    """

    username = (payload.username or "").strip()
    user = get_user_by_username(db, username)
    if user is None or user.status != "ACTIVE" or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error_code": "USER_AUTH_FAILED", "message": "Invalid username or password."},
        )

    role = _normalize_role(user.role)
    user.last_login_at = _utcnow()
    token_version = int(getattr(user, "token_version", 1) or 1)
    must_change = bool(getattr(user, "must_change_password", False))
    journal.record_audit_event(
        db,
        action="USER_LOGIN",
        actor_username=username,
        entity_type="PLATFORM_USER",
        entity_id=int(user.id),
        entity_name=username,
        details={"role": role, "session": "jwt"},
    )
    db.commit()
    return _build_token_bundle(
        user_id=int(user.id),
        username=username,
        role=role,
        token_version=token_version,
        user_status=str(user.status),
        must_change_password=must_change,
    )


@router.post("/refresh", response_model=TokenBundle)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)) -> TokenBundle:
    """Exchange a valid refresh JWT for a fresh access + refresh pair.

    Token rotation: every refresh produces a new refresh token alongside the
    new access token.  Token version mismatches (e.g. after a password change
    or admin-initiated logout) are rejected.
    """

    try:
        claims: TokenClaims = decode_token(payload.refresh_token, expected_type=TOKEN_TYPE_REFRESH)
    except AuthTokenError as exc:
        raise _auth_error(exc.code, exc.message) from exc

    user = get_user_by_id(db, claims.user_id)
    if user is None or user.status != "ACTIVE":
        raise _auth_error("AUTH_USER_INACTIVE", "Account is inactive or removed.")
    if int(getattr(user, "token_version", 1) or 1) != claims.token_version:
        raise _auth_error("AUTH_TOKEN_REVOKED", "Session was invalidated; please sign in again.")

    role = _normalize_role(user.role)
    must_change = bool(getattr(user, "must_change_password", False))
    journal.record_audit_event(
        db,
        action="USER_TOKEN_REFRESHED",
        actor_username=str(user.username),
        entity_type="PLATFORM_USER",
        entity_id=int(user.id),
        entity_name=str(user.username),
        details={"role": role},
    )
    db.commit()
    return _build_token_bundle(
        user_id=int(user.id),
        username=str(user.username),
        role=role,
        token_version=int(getattr(user, "token_version", 1) or 1),
        user_status=str(user.status),
        must_change_password=must_change,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    payload: LogoutRequest | None = Body(default=None),
    db: Session = Depends(get_db),
) -> None:
    """Best-effort logout.

    The client always discards its tokens after calling this endpoint.  When
    ``revoke_all`` is true, we additionally bump ``platform_users.token_version``
    so previously issued refresh tokens (and any other concurrent sessions) are
    rejected on their next use.  Logout is idempotent — calling it without a
    valid bearer token still returns 204.
    """

    ctx = resolve_auth_context(request)
    revoke_all = bool(payload.revoke_all) if payload else False
    if ctx.source == "jwt" and ctx.user_id is not None:
        user = get_user_by_id(db, ctx.user_id)
        if user is not None:
            details = {"revoke_all": revoke_all, "role": ctx.role}
            if revoke_all:
                user.token_version = int(getattr(user, "token_version", 1) or 1) + 1
            journal.record_audit_event(
                db,
                action="USER_LOGOUT",
                actor_username=str(user.username),
                entity_type="PLATFORM_USER",
                entity_id=int(user.id),
                entity_name=str(user.username),
                details=details,
            )
            db.commit()
    return None


@router.post("/change-password", response_model=SelfPasswordChangeResponse)
def change_own_password(
    request: Request,
    payload: SelfPasswordChangeRequest,
    db: Session = Depends(get_db),
) -> SelfPasswordChangeResponse:
    """Rotate password for the authenticated principal (spec 039).

    Requires the current password, rejects the weak default ``admin`` as a new
    password, clears ``must_change_password``, bumps ``token_version`` (JWTs
    must be re-issued via a fresh login).
    """

    ctx = resolve_auth_context(request)
    if ctx.source != "jwt" or ctx.user_id is None:
        raise _auth_error("AUTH_REQUIRED", "Authentication is required for this endpoint.")
    user = get_user_by_id(db, int(ctx.user_id))
    if user is None or user.status != "ACTIVE":
        raise _auth_error("AUTH_USER_INACTIVE", "Account is inactive or removed.")
    if int(getattr(user, "token_version", 1) or 1) != (ctx.token_version or 0):
        raise _auth_error("AUTH_TOKEN_REVOKED", "Session was invalidated; please sign in again.")

    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error_code": "USER_AUTH_FAILED", "message": "Current password is incorrect."},
        )

    try:
        validate_new_platform_password(payload.new_password)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error_code": "PASSWORD_POLICY_REJECTED", "message": str(exc)},
        ) from exc

    user.password_hash = get_password_hash(payload.new_password)
    user.must_change_password = False
    user.token_version = int(getattr(user, "token_version", 1) or 1) + 1
    journal.record_audit_event(
        db,
        action="PASSWORD_CHANGED",
        actor_username=str(user.username),
        entity_type="PLATFORM_USER",
        entity_id=int(user.id),
        entity_name=str(user.username),
        details={"self_service": True, "token_version_bumped": True},
    )
    db.commit()
    return SelfPasswordChangeResponse()


@router.get("/whoami", response_model=WhoAmIResponse)
def whoami(request: Request, db: Session = Depends(get_db)) -> WhoAmIResponse:
    """Return the verified identity for the current request.

    Validates the bearer token (including ``token_version`` against the live
    row).  When no token is present and the deployment does not require auth,
    we echo the implicit anonymous-administrator fallback so existing tooling
    keeps working.
    """

    ctx = resolve_auth_context(request)
    if ctx.source == "jwt":
        # Cross-check token_version against the live row.
        user = get_user_by_id(db, int(ctx.user_id or 0))
        if user is None or user.status != "ACTIVE":
            raise _auth_error("AUTH_USER_INACTIVE", "Account is inactive or removed.")
        if int(getattr(user, "token_version", 1) or 1) != (ctx.token_version or 0):
            raise _auth_error("AUTH_TOKEN_REVOKED", "Session was invalidated; please sign in again.")
        expires_at = ctx.claims.expires_at.isoformat() if ctx.claims else None
        return WhoAmIResponse(
            username=ctx.username,
            role=ctx.role,
            authenticated=True,
            must_change_password=bool(getattr(user, "must_change_password", False)),
            token_expires_at=expires_at,
            capabilities=build_capabilities(ctx.role),
        )
    if ctx.source == "invalid_token":
        raise _auth_error("AUTH_TOKEN_INVALID", "Invalid authentication token.")
    if settings.REQUIRE_AUTH:
        raise _auth_error("AUTH_REQUIRED", "Authentication is required for this endpoint.")
    return WhoAmIResponse(
        username=ctx.username,
        role=ctx.role,
        authenticated=False,
        must_change_password=False,
        capabilities=build_capabilities(ctx.role),
    )
