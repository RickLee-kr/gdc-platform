"""OAuth2 Authorization Code + refresh-token lifecycle for Credential.

Provider-agnostic: reads authorization_url / token_url / client_id / secret / scopes
from credential ``auth_json`` (same field aliases as connector auth normalize).

PKCE (S256) is enabled by default for the authorization request. Set
``pkce_enabled: false`` in auth_json when a provider rejects PKCE parameters.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

from sqlalchemy.orm import Session

from app.config import settings
from app.credentials.models import (
    AUTH_TYPE_OAUTH2_AUTHORIZATION_CODE,
    CREDENTIAL_STATUS_CONNECTED,
    CREDENTIAL_STATUS_NEEDS_RECONNECT,
    CREDENTIAL_STATUS_REVOKED,
    Credential,
    CredentialOAuthState,
)
from app.credentials.oauth2_token_http import (
    OAuth2ProtocolError,
    OAuth2TransportError,
    post_oauth2_token,
)
from app.database import SessionLocal, utcnow

logger = logging.getLogger(__name__)

# Refresh slightly before wall-clock expiry to avoid edge races.
ACCESS_TOKEN_EXPIRY_SKEW = timedelta(seconds=60)
OAUTH_STATE_TTL = timedelta(minutes=15)
STATE_BYTES = 32


class OAuth2AuthCodeError(ValueError):
    """Structured failure for authorize / callback / reconnect / runtime refresh."""

    def __init__(self, message: str, *, error_code: str, status_hint: int = 400) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.status_hint = status_hint


def is_oauth2_authorization_code(auth_type: str | None) -> bool:
    return str(auth_type or "").strip().upper() == AUTH_TYPE_OAUTH2_AUTHORIZATION_CODE


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def parse_expires_at(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return _as_utc(value)
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return _as_utc(datetime.fromisoformat(text))
    except ValueError:
        return None


def access_token_is_valid(auth: dict[str, Any], *, now: datetime | None = None) -> bool:
    token = str(auth.get("access_token") or "").strip()
    if not token:
        return False
    expires_at = parse_expires_at(auth.get("expires_at"))
    if expires_at is None:
        return True
    clock = _as_utc(now or utcnow())
    return expires_at > clock + ACCESS_TOKEN_EXPIRY_SKEW


def _lookup(auth: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in auth and auth[key] is not None and str(auth[key]).strip() != "":
            return auth[key]
    return None


def read_oauth2_client_config(auth: dict[str, Any]) -> dict[str, str]:
    authorization_url = str(
        _lookup(auth, "oauth2_authorization_url", "authorization_url", "auth_url") or ""
    ).strip()
    token_url = str(
        _lookup(auth, "oauth2_token_url", "oauth_token_url", "token_url") or ""
    ).strip()
    client_id = str(
        _lookup(auth, "oauth2_client_id", "oauth_client_id", "client_id") or ""
    ).strip()
    client_secret = str(
        _lookup(auth, "oauth2_client_secret", "oauth_client_secret", "client_secret") or ""
    ).strip()
    scope = str(_lookup(auth, "oauth2_scope", "oauth_scope", "scopes", "scope") or "").strip()
    redirect_override = str(
        _lookup(auth, "oauth2_redirect_uri", "redirect_uri") or ""
    ).strip()
    return {
        "authorization_url": authorization_url,
        "token_url": token_url,
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": scope,
        "redirect_uri_override": redirect_override,
    }


def pkce_enabled(auth: dict[str, Any]) -> bool:
    raw = auth.get("pkce_enabled")
    if raw is None:
        return True
    if isinstance(raw, bool):
        return raw
    return str(raw).strip().lower() not in {"0", "false", "no", "off"}


def generate_pkce_pair() -> tuple[str, str]:
    """Return ``(code_verifier, code_challenge)`` using S256."""

    verifier = secrets.token_urlsafe(64)[:128]
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def generate_oauth_state() -> str:
    return secrets.token_urlsafe(STATE_BYTES)


def default_oauth_redirect_uri(*, request_base_url: str | None = None) -> str:
    configured = (settings.PLATFORM_OAUTH_REDIRECT_URI or "").strip()
    if configured:
        return configured
    api_base = (settings.PLATFORM_PUBLIC_API_BASE_URL or "").rstrip("/")
    if api_base:
        prefix = (settings.API_PREFIX or "/api/v1").rstrip("/")
        return f"{api_base}{prefix}/credentials/oauth2/callback"
    base = (request_base_url or "").rstrip("/")
    if not base:
        raise OAuth2AuthCodeError(
            "redirect_uri required: set PLATFORM_OAUTH_REDIRECT_URI, "
            "PLATFORM_PUBLIC_API_BASE_URL, auth_json.oauth2_redirect_uri, "
            "or call authorize with a request base URL",
            error_code="OAUTH2_REDIRECT_URI_MISSING",
        )
    prefix = (settings.API_PREFIX or "/api/v1").rstrip("/")
    return f"{base}{prefix}/credentials/oauth2/callback"


def resolve_redirect_uri(auth: dict[str, Any], *, request_base_url: str | None = None) -> str:
    cfg = read_oauth2_client_config(auth)
    if cfg["redirect_uri_override"]:
        return cfg["redirect_uri_override"]
    return default_oauth_redirect_uri(request_base_url=request_base_url)


def _require_auth_code_credential(row: Credential) -> None:
    if not is_oauth2_authorization_code(row.auth_type):
        raise OAuth2AuthCodeError(
            f"credential {int(row.id)} auth_type is {row.auth_type}, "
            f"expected {AUTH_TYPE_OAUTH2_AUTHORIZATION_CODE}",
            error_code="OAUTH2_AUTH_TYPE_MISMATCH",
            status_hint=422,
        )
    if str(row.status or "").strip().upper() == CREDENTIAL_STATUS_REVOKED:
        raise OAuth2AuthCodeError(
            f"credential {int(row.id)} is REVOKED",
            error_code="CREDENTIAL_REVOKED",
            status_hint=409,
        )


def begin_authorization(
    db: Session,
    row: Credential,
    *,
    request_base_url: str | None = None,
) -> dict[str, Any]:
    """Create one-time state (+ PKCE) and return the provider authorization URL."""

    _require_auth_code_credential(row)
    auth = dict(row.auth_json or {})
    cfg = read_oauth2_client_config(auth)
    if not cfg["authorization_url"] or not cfg["client_id"] or not cfg["token_url"]:
        raise OAuth2AuthCodeError(
            "oauth2 authorization_url, token_url, and client_id are required",
            error_code="OAUTH2_CONFIG_INVALID",
            status_hint=422,
        )
    redirect_uri = resolve_redirect_uri(auth, request_base_url=request_base_url)
    state = generate_oauth_state()
    code_verifier: str | None = None
    code_challenge: str | None = None
    if pkce_enabled(auth):
        code_verifier, code_challenge = generate_pkce_pair()

    now = utcnow()
    db.add(
        CredentialOAuthState(
            state=state,
            credential_id=int(row.id),
            code_verifier=code_verifier,
            redirect_uri=redirect_uri,
            created_at=now,
            expires_at=now + OAUTH_STATE_TTL,
            consumed_at=None,
        )
    )
    # Re-authorize clears a stuck reconnect flag only after successful callback;
    # leave status as-is here (CONNECTED stays CONNECTED; NEEDS_RECONNECT stays).
    db.flush()

    params: dict[str, str] = {
        "response_type": "code",
        "client_id": cfg["client_id"],
        "redirect_uri": redirect_uri,
        "state": state,
    }
    if cfg["scope"]:
        params["scope"] = cfg["scope"]
    if code_challenge:
        params["code_challenge"] = code_challenge
        params["code_challenge_method"] = "S256"

    sep = "&" if "?" in cfg["authorization_url"] else "?"
    authorization_url = f"{cfg['authorization_url']}{sep}{urlencode(params)}"
    return {
        "credential_id": int(row.id),
        "authorization_url": authorization_url,
        "state": state,
        "redirect_uri": redirect_uri,
        "expires_at": now + OAUTH_STATE_TTL,
        "pkce": bool(code_challenge),
    }


def _apply_token_response(auth: dict[str, Any], token_json: dict[str, Any], *, now: datetime) -> dict[str, Any]:
    access_token = token_json.get("access_token")
    if not access_token:
        raise OAuth2AuthCodeError(
            "oauth2 token response missing access_token",
            error_code="OAUTH2_TOKEN_MISSING",
        )
    out = dict(auth)
    out["access_token"] = str(access_token)
    if token_json.get("refresh_token"):
        # Refresh-token rotation: always replace when provider returns a new value.
        out["refresh_token"] = str(token_json["refresh_token"])
    token_type = token_json.get("token_type")
    if token_type:
        out["token_type"] = str(token_type)
    scope = token_json.get("scope")
    if scope is not None and str(scope).strip() != "":
        out["scope"] = str(scope)
    expires_in = token_json.get("expires_in")
    if expires_in is not None:
        try:
            out["expires_at"] = (now + timedelta(seconds=int(expires_in))).isoformat()
        except (TypeError, ValueError):
            pass
    explicit_exp = parse_expires_at(token_json.get("expires_at"))
    if explicit_exp is not None:
        out["expires_at"] = explicit_exp.isoformat()
    out["auth_type"] = "oauth2_authorization_code"
    return out


def exchange_authorization_code(
    db: Session,
    *,
    code: str,
    state: str,
    verify_ssl: bool = True,
    timeout_seconds: float = 30.0,
) -> Credential:
    """Validate state (one-time), exchange code, persist tokens, mark CONNECTED."""

    code = str(code or "").strip()
    state = str(state or "").strip()
    if not code or not state:
        raise OAuth2AuthCodeError(
            "code and state are required",
            error_code="OAUTH2_CALLBACK_INVALID",
            status_hint=400,
        )

    now = utcnow()
    pending = (
        db.query(CredentialOAuthState)
        .filter(CredentialOAuthState.state == state)
        .with_for_update()
        .first()
    )
    if pending is None:
        raise OAuth2AuthCodeError(
            "unknown or expired oauth state",
            error_code="OAUTH2_STATE_INVALID",
            status_hint=400,
        )
    if pending.consumed_at is not None:
        raise OAuth2AuthCodeError(
            "oauth state already consumed",
            error_code="OAUTH2_STATE_REPLAY",
            status_hint=400,
        )
    if _as_utc(pending.expires_at) < now:
        pending.consumed_at = now
        db.flush()
        raise OAuth2AuthCodeError(
            "oauth state expired",
            error_code="OAUTH2_STATE_EXPIRED",
            status_hint=400,
        )

    row = (
        db.query(Credential)
        .filter(Credential.id == int(pending.credential_id))
        .with_for_update()
        .first()
    )
    if row is None:
        raise OAuth2AuthCodeError(
            "credential not found for oauth state",
            error_code="CREDENTIAL_NOT_FOUND",
            status_hint=404,
        )
    _require_auth_code_credential(row)

    auth = dict(row.auth_json or {})
    cfg = read_oauth2_client_config(auth)
    if not cfg["token_url"] or not cfg["client_id"] or not cfg["client_secret"]:
        raise OAuth2AuthCodeError(
            "oauth2 token_url/client_id/client_secret is required",
            error_code="OAUTH2_CONFIG_INVALID",
            status_hint=422,
        )

    form: dict[str, str] = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": pending.redirect_uri,
    }
    if pending.code_verifier:
        form["code_verifier"] = pending.code_verifier

    # Consume state before token HTTP so replays fail even if exchange is slow.
    pending.consumed_at = now
    db.flush()

    try:
        token_json = post_oauth2_token(
            cfg["token_url"],
            form,
            client_id=cfg["client_id"],
            client_secret=cfg["client_secret"],
            verify_ssl=verify_ssl,
            timeout_seconds=timeout_seconds,
        )
    except OAuth2ProtocolError as exc:
        logger.info(
            "oauth2_code_exchange_protocol_error",
            extra={"credential_id": int(row.id), "error": exc.error, "status_code": exc.status_code},
        )
        row.status = CREDENTIAL_STATUS_NEEDS_RECONNECT
        db.flush()
        raise OAuth2AuthCodeError(
            "oauth2 authorization code exchange failed",
            error_code="OAUTH2_CODE_EXCHANGE_FAILED",
            status_hint=400,
        ) from exc
    except OAuth2TransportError as exc:
        raise OAuth2AuthCodeError(
            "oauth2 authorization code exchange transport failed",
            error_code="OAUTH2_CODE_EXCHANGE_TRANSPORT",
            status_hint=502,
        ) from exc

    row.auth_json = _apply_token_response(auth, token_json, now=now)
    row.status = CREDENTIAL_STATUS_CONNECTED
    db.flush()
    return row


def reconnect_authorization(
    db: Session,
    row: Credential,
    *,
    request_base_url: str | None = None,
) -> dict[str, Any]:
    """Start a fresh authorization (user re-consent). Marks NEEDS_RECONNECT until callback."""

    _require_auth_code_credential(row)
    row.status = CREDENTIAL_STATUS_NEEDS_RECONNECT
    db.flush()
    return begin_authorization(db, row, request_base_url=request_base_url)


def _refresh_locked_credential(
    db: Session,
    row: Credential,
    *,
    verify_ssl: bool = True,
    timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    """Caller must hold ``FOR UPDATE`` on ``row``. Returns updated auth_json."""

    status = str(row.status or "").strip().upper()
    if status == CREDENTIAL_STATUS_REVOKED:
        raise OAuth2AuthCodeError(
            f"credential {int(row.id)} is REVOKED",
            error_code="CREDENTIAL_REVOKED",
            status_hint=403,
        )
    if status not in {CREDENTIAL_STATUS_CONNECTED, CREDENTIAL_STATUS_NEEDS_RECONNECT}:
        # EXPIRED with refresh_token is still refreshable; treat as refresh path.
        if status != "EXPIRED":
            raise OAuth2AuthCodeError(
                f"credential {int(row.id)} status is {status or 'UNKNOWN'}; expected CONNECTED",
                error_code="CREDENTIAL_NOT_USABLE",
                status_hint=403,
            )

    auth = dict(row.auth_json or {})
    if access_token_is_valid(auth):
        if status != CREDENTIAL_STATUS_CONNECTED:
            row.status = CREDENTIAL_STATUS_CONNECTED
            db.flush()
        return auth

    refresh_token = str(auth.get("refresh_token") or "").strip()
    if not refresh_token:
        row.status = CREDENTIAL_STATUS_NEEDS_RECONNECT
        db.flush()
        raise OAuth2AuthCodeError(
            f"credential {int(row.id)} access token expired and no refresh_token",
            error_code="OAUTH2_REFRESH_REQUIRED",
            status_hint=401,
        )

    cfg = read_oauth2_client_config(auth)
    if not cfg["token_url"] or not cfg["client_id"] or not cfg["client_secret"]:
        row.status = CREDENTIAL_STATUS_NEEDS_RECONNECT
        db.flush()
        raise OAuth2AuthCodeError(
            "oauth2 token_url/client_id/client_secret is required for refresh",
            error_code="OAUTH2_CONFIG_INVALID",
            status_hint=422,
        )

    form = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    if cfg["scope"]:
        form["scope"] = cfg["scope"]

    now = utcnow()
    try:
        token_json = post_oauth2_token(
            cfg["token_url"],
            form,
            client_id=cfg["client_id"],
            client_secret=cfg["client_secret"],
            verify_ssl=verify_ssl,
            timeout_seconds=timeout_seconds,
        )
    except OAuth2ProtocolError as exc:
        # invalid_grant / revoked refresh → reconnect; do not leave stale "success" tokens.
        row.status = CREDENTIAL_STATUS_NEEDS_RECONNECT
        db.flush()
        logger.info(
            "oauth2_refresh_protocol_error",
            extra={"credential_id": int(row.id), "error": exc.error, "status_code": exc.status_code},
        )
        raise OAuth2AuthCodeError(
            "oauth2 refresh token rejected; reconnect required",
            error_code="OAUTH2_INVALID_GRANT"
            if exc.is_invalid_grant
            else "OAUTH2_REFRESH_FAILED",
            status_hint=401,
        ) from exc
    except OAuth2TransportError as exc:
        # Transient — leave status CONNECTED so a later poll can retry refresh.
        raise OAuth2AuthCodeError(
            "oauth2 refresh transport failed",
            error_code="OAUTH2_REFRESH_TRANSPORT",
            status_hint=502,
        ) from exc

    updated = _apply_token_response(auth, token_json, now=now)
    # Atomic credential update: access + optional rotated refresh + expires_at together.
    row.auth_json = updated
    row.status = CREDENTIAL_STATUS_CONNECTED
    db.flush()
    return updated


def ensure_fresh_oauth2_authorization_code_credential(
    credential_id: int,
    *,
    verify_ssl: bool = True,
    timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    """Single-flight refresh via row lock; commits token updates in a dedicated session."""

    db = SessionLocal()
    try:
        row = (
            db.query(Credential)
            .filter(Credential.id == int(credential_id))
            .with_for_update()
            .first()
        )
        if row is None:
            raise OAuth2AuthCodeError(
                f"credential not found: {credential_id}",
                error_code="CREDENTIAL_NOT_FOUND",
                status_hint=404,
            )
        if not is_oauth2_authorization_code(row.auth_type):
            auth = dict(row.auth_json or {})
            if "auth_type" not in auth and row.auth_type:
                auth["auth_type"] = str(row.auth_type).lower()
            db.commit()
            return auth

        status = str(row.status or "").strip().upper()
        if status == CREDENTIAL_STATUS_REVOKED:
            raise OAuth2AuthCodeError(
                f"credential {int(row.id)} is REVOKED",
                error_code="CREDENTIAL_REVOKED",
                status_hint=403,
            )
        if status == CREDENTIAL_STATUS_NEEDS_RECONNECT:
            raise OAuth2AuthCodeError(
                f"credential {int(row.id)} status is NEEDS_RECONNECT; expected CONNECTED",
                error_code="CREDENTIAL_NEEDS_RECONNECT",
                status_hint=403,
            )
        if status != CREDENTIAL_STATUS_CONNECTED and status != "EXPIRED":
            raise OAuth2AuthCodeError(
                f"credential {int(row.id)} status is {status or 'UNKNOWN'}; expected CONNECTED",
                error_code="CREDENTIAL_NOT_USABLE",
                status_hint=403,
            )

        auth = _refresh_locked_credential(
            db,
            row,
            verify_ssl=verify_ssl,
            timeout_seconds=timeout_seconds,
        )
        db.commit()
        if "auth_type" not in auth:
            auth["auth_type"] = "oauth2_authorization_code"
        return auth
    except OAuth2AuthCodeError:
        # Persist NEEDS_RECONNECT / status mutations from the refresh path before re-raising.
        try:
            db.commit()
        except Exception:
            db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def refresh_access_token_in_memory(
    auth: dict[str, Any],
    *,
    verify_ssl: bool = True,
    proxy_url: str | None = None,
    timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    """Refresh without DB persist (preview / legacy inline auth_json path)."""

    if access_token_is_valid(auth):
        return auth
    refresh_token = str(auth.get("refresh_token") or "").strip()
    if not refresh_token:
        raise OAuth2AuthCodeError(
            "access token expired and no refresh_token",
            error_code="OAUTH2_REFRESH_REQUIRED",
            status_hint=401,
        )
    cfg = read_oauth2_client_config(auth)
    if not cfg["token_url"] or not cfg["client_id"] or not cfg["client_secret"]:
        raise OAuth2AuthCodeError(
            "oauth2 token_url/client_id/client_secret is required for refresh",
            error_code="OAUTH2_CONFIG_INVALID",
            status_hint=422,
        )
    form = {"grant_type": "refresh_token", "refresh_token": refresh_token}
    if cfg["scope"]:
        form["scope"] = cfg["scope"]
    token_json = post_oauth2_token(
        cfg["token_url"],
        form,
        client_id=cfg["client_id"],
        client_secret=cfg["client_secret"],
        verify_ssl=verify_ssl,
        proxy_url=proxy_url,
        timeout_seconds=timeout_seconds,
    )
    return _apply_token_response(auth, token_json, now=utcnow())
