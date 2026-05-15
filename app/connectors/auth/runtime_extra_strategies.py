"""Additional HTTP auth strategies (no-auth, OAuth2 CC, JWT refresh, session cookie flow)."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import httpx

from app.connectors.auth.base import AuthStrategy
from app.connectors.auth.http_common import build_request_url, build_token_value, extract_json_path_value
from app.runtime.errors import PreviewRequestError


class NoAuthStrategy(AuthStrategy):
    def apply(
        self,
        auth: dict[str, Any],
        headers: dict[str, str],
        params: dict[str, Any],
        *,
        verify_ssl: bool,
        proxy_url: str | None,
        timeout_seconds: float,
        base_url: str,
    ) -> tuple[dict[str, str], dict[str, Any]]:
        return headers, params


class OAuth2ClientCredentialsStrategy(AuthStrategy):
    def apply(
        self,
        auth: dict[str, Any],
        headers: dict[str, str],
        params: dict[str, Any],
        *,
        verify_ssl: bool,
        proxy_url: str | None,
        timeout_seconds: float,
        base_url: str,
    ) -> tuple[dict[str, str], dict[str, Any]]:
        token_url = str(auth.get("oauth2_token_url") or auth.get("token_url") or "")
        client_id = str(auth.get("client_id") or "")
        client_secret = str(auth.get("client_secret") or "")
        scope = str(auth.get("scope") or "").strip()
        if not token_url or not client_id or not client_secret:
            raise PreviewRequestError(
                400,
                {"code": "OAUTH2_CONFIG_INVALID", "message": "oauth2 token_url/client_id/client_secret is required"},
            )
        form = {"grant_type": "client_credentials"}
        if scope:
            form["scope"] = scope
        try:
            with httpx.Client(verify=verify_ssl, proxy=proxy_url, timeout=timeout_seconds) as client:
                token_resp = client.post(
                    token_url,
                    data=urlencode(form),
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    auth=(client_id, client_secret),
                )
            token_resp.raise_for_status()
            token_json = token_resp.json()
            access_token = token_json.get("access_token")
            if not access_token:
                raise PreviewRequestError(
                    400,
                    {"code": "OAUTH2_TOKEN_MISSING", "message": "oauth2 token response missing access_token"},
                )
            headers.setdefault("Authorization", f"Bearer {access_token}")
            return headers, params
        except PreviewRequestError:
            raise
        except Exception as exc:
            raise PreviewRequestError(
                400,
                {"code": "OAUTH2_TOKEN_REQUEST_FAILED", "message": str(exc)},
            ) from exc


class SessionLoginAuthStrategy(AuthStrategy):
    """Session cookies are acquired separately; only validate credentials are present."""

    def apply(
        self,
        auth: dict[str, Any],
        headers: dict[str, str],
        params: dict[str, Any],
        *,
        verify_ssl: bool,
        proxy_url: str | None,
        timeout_seconds: float,
        base_url: str,
    ) -> tuple[dict[str, str], dict[str, Any]]:
        username = str(auth.get("login_username") or "")
        password = str(auth.get("login_password") or "")
        if not username or not password:
            raise PreviewRequestError(
                400,
                {"error_type": "session_login_failed", "message": "login_username/login_password is required"},
            )
        return headers, params


class JwtRefreshTokenAuthStrategy(AuthStrategy):
    def apply(
        self,
        auth: dict[str, Any],
        headers: dict[str, str],
        params: dict[str, Any],
        *,
        verify_ssl: bool,
        proxy_url: str | None,
        timeout_seconds: float,
        base_url: str,
    ) -> tuple[dict[str, str], dict[str, Any]]:
        refresh_token = str(auth.get("refresh_token") or "")
        token_url = str(auth.get("token_url") or "").strip()
        token_path = str(auth.get("token_path") or "").strip()
        if not refresh_token:
            raise PreviewRequestError(400, {"error_type": "token_refresh_failed", "message": "refresh_token is required"})
        if not (token_url or token_path):
            raise PreviewRequestError(400, {"error_type": "token_refresh_failed", "message": "token_url/token_path is required"})
        resolved_token_url = token_url or build_request_url(base_url, token_path)
        token_headers = {
            str(auth.get("refresh_token_header_name") or "Authorization"): build_token_value(
                auth.get("refresh_token_header_prefix"), refresh_token
            )
        }
        token_method = str(auth.get("token_http_method") or "POST").upper()
        try:
            with httpx.Client(verify=verify_ssl, proxy=proxy_url, timeout=timeout_seconds) as client:
                token_resp = client.request(method=token_method, url=resolved_token_url, headers=token_headers)
            token_resp.raise_for_status()
            token_json = token_resp.json()
            access_token = extract_json_path_value(token_json, str(auth.get("access_token_json_path") or "$.access_token"))
            if not access_token:
                raise PreviewRequestError(
                    400,
                    {"error_type": "token_refresh_failed", "message": "access_token not found in token response"},
                )
            headers[str(auth.get("access_token_header_name") or "Authorization")] = build_token_value(
                auth.get("access_token_header_prefix"), str(access_token)
            )
            return headers, params
        except PreviewRequestError:
            raise
        except Exception as exc:
            raise PreviewRequestError(400, {"error_type": "token_refresh_failed", "message": str(exc)}) from exc
