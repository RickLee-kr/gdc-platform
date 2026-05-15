"""Registry dispatch for ``AuthStrategy`` implementations."""

from __future__ import annotations

from typing import Any

from app.connectors.auth.api_key import ApiKeyAuthStrategy
from app.connectors.auth.base import AuthStrategy
from app.connectors.auth.basic import BasicAuthStrategy
from app.connectors.auth.bearer import BearerAuthStrategy
from app.connectors.auth.runtime_extra_strategies import (
    JwtRefreshTokenAuthStrategy,
    NoAuthStrategy,
    OAuth2ClientCredentialsStrategy,
    SessionLoginAuthStrategy,
)
from app.connectors.auth.vendor_jwt_exchange import VendorJwtExchangeAuthStrategy
from app.runtime.errors import PreviewRequestError


class AuthStrategyRegistry:
    """Maps normalized ``auth_type`` string to a strategy instance."""

    _by_type: dict[str, AuthStrategy] = {
        "": NoAuthStrategy(),
        "NO_AUTH": NoAuthStrategy(),
        "BASIC": BasicAuthStrategy(),
        "BEARER": BearerAuthStrategy(),
        "API_KEY": ApiKeyAuthStrategy(),
        "OAUTH2_CLIENT_CREDENTIALS": OAuth2ClientCredentialsStrategy(),
        "SESSION_LOGIN": SessionLoginAuthStrategy(),
        "JWT_REFRESH_TOKEN": JwtRefreshTokenAuthStrategy(),
        "VENDOR_JWT_EXCHANGE": VendorJwtExchangeAuthStrategy(),
    }

    @classmethod
    def get(cls, auth_type: str | None) -> AuthStrategy:
        key = (auth_type or "").strip().upper()
        if key in {"", "NO_AUTH"}:
            return cls._by_type["NO_AUTH"]
        strat = cls._by_type.get(key)
        if strat is None:
            raise PreviewRequestError(
                400,
                {"code": "AUTH_TYPE_UNSUPPORTED", "message": f"unsupported auth_type: {key}"},
            )
        return strat

    @classmethod
    def register(cls, auth_type: str, strategy: AuthStrategy) -> None:
        """Register or replace a strategy (primarily for tests / future plugins)."""

        cls._by_type[auth_type.strip().upper()] = strategy


def apply_auth_to_http_request(
    auth: dict[str, Any],
    headers: dict[str, str],
    params: dict[str, Any],
    verify_ssl: bool,
    proxy_url: str | None,
    timeout_seconds: float,
    base_url: str,
) -> tuple[dict[str, str], dict[str, Any]]:
    """Apply auth strategy for the outbound resource request (poller + preview paths)."""

    strategy = AuthStrategyRegistry.get(auth.get("auth_type"))
    return strategy.apply(
        auth,
        headers,
        params,
        verify_ssl=verify_ssl,
        proxy_url=proxy_url,
        timeout_seconds=timeout_seconds,
        base_url=base_url,
    )
