"""Dispatch/regression tests for source/auth/destination adapter registries."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.connectors.auth.api_key import ApiKeyAuthStrategy
from app.connectors.auth.bearer import BearerAuthStrategy
from app.connectors.auth.basic import BasicAuthStrategy
from app.connectors.auth.normalize import normalize_connector_auth
from app.connectors.auth.registry import AuthStrategyRegistry, apply_auth_to_http_request
from app.connectors.auth.vendor_jwt_exchange import VendorJwtExchangeAuthStrategy
from app.destinations.adapters.registry import DestinationAdapterRegistry
from app.destinations.adapters.webhook_post import WebhookPostDestinationAdapter
from app.pollers.http_poller import HttpPoller
from app.sources.adapters.http_api import HttpApiSourceAdapter
from app.sources.adapters.registry import SourceAdapterRegistry
from app.runtime.errors import PreviewRequestError


def test_auth_strategy_registry_dispatch_basic_bearer_api_vendor_instances() -> None:
    assert isinstance(AuthStrategyRegistry.get("BASIC"), BasicAuthStrategy)
    assert isinstance(AuthStrategyRegistry.get("BEARER"), BearerAuthStrategy)
    assert isinstance(AuthStrategyRegistry.get("API_KEY"), ApiKeyAuthStrategy)
    assert isinstance(AuthStrategyRegistry.get("VENDOR_JWT_EXCHANGE"), VendorJwtExchangeAuthStrategy)


def test_apply_auth_basic_sets_authorization_header() -> None:
    auth = normalize_connector_auth({"auth_type": "basic", "basic_username": "u", "basic_password": "p"})
    h, p = apply_auth_to_http_request(auth, {}, {}, True, None, 30.0, "https://api.example.com")
    assert h.get("Authorization", "").startswith("Basic ")


def test_destination_registry_dispatch_syslog_webhook_types() -> None:
    reg = DestinationAdapterRegistry()
    udp = reg.get("SYSLOG_UDP")
    tcp = reg.get("SYSLOG_TCP")
    wh = reg.get("WEBHOOK_POST")
    assert udp.__class__.__name__ == "SyslogUdpDestinationAdapter"
    assert tcp.__class__.__name__ == "SyslogTcpDestinationAdapter"
    assert isinstance(wh, WebhookPostDestinationAdapter)


def test_source_adapter_registry_includes_s3_object_polling() -> None:
    reg = SourceAdapterRegistry()
    assert reg.get("S3_OBJECT_POLLING").__class__.__name__ == "S3ObjectPollingAdapter"


def test_source_adapter_registry_includes_database_query() -> None:
    reg = SourceAdapterRegistry()
    assert reg.get("DATABASE_QUERY").__class__.__name__ == "DatabaseQuerySourceAdapter"


def test_source_adapter_registry_includes_remote_file_polling() -> None:
    reg = SourceAdapterRegistry()
    assert reg.get("REMOTE_FILE_POLLING").__class__.__name__ == "RemoteFilePollingAdapter"


def test_source_adapter_registry_http_api_delegates_to_poller(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[Any] = []

    class _P:
        def fetch(self, sc: dict[str, Any], st: dict[str, Any], ck: dict[str, Any] | None) -> dict[str, Any]:
            calls.append((sc, st, ck))
            return {"ok": True}

    reg = SourceAdapterRegistry(http_poller=_P())
    out = reg.get("HTTP_API_POLLING").fetch({}, {}, None)
    assert out == {"ok": True}
    assert len(calls) == 1


def test_http_api_source_adapter_uses_http_poller_fetch() -> None:
    poller = HttpPoller()
    adapter = HttpApiSourceAdapter(poller)
    with patch.object(poller, "fetch", return_value={"items": []}) as m:
        adapter.fetch({"base_url": "https://x.com"}, {"endpoint": "/a"}, {"cursor": "1"})
    m.assert_called_once()


def test_vendor_jwt_exchange_strategy_merges_token() -> None:
    """Vendor JWT path still injects bearer auth after token exchange (registry dispatch)."""

    def _fake_exchange(
        client: httpx.Client,
        ctx: Any,
        auth_cfg: dict[str, Any],
        path_origin: str,
        *,
        token_diag_out: dict[str, Any] | None = None,
    ) -> str:
        return "tok-123"

    strat = VendorJwtExchangeAuthStrategy()
    auth = normalize_connector_auth(
        {
            "auth_type": "VENDOR_JWT_EXCHANGE",
            "token_url": "https://vendor.example/token",
            "user_id": "u",
            "api_key": "k",
        }
    )
    with patch("app.connectors.auth.vendor_jwt_exchange.vendor_jwt_run_token_exchange", side_effect=_fake_exchange):
        h, _p = strat.apply(
            auth,
            {},
            {},
            verify_ssl=True,
            proxy_url=None,
            timeout_seconds=5.0,
            base_url="https://api.example.com",
        )
    assert h.get("Authorization") == "Bearer tok-123"


def test_stream_runner_has_no_source_auth_destination_branching() -> None:
    """Guard: runtime orchestration must not reintroduce type-specific if-chains (PLUGIN_ADAPTER policy)."""

    text = Path("app/runners/stream_runner.py").read_text(encoding="utf-8")
    pat = re.compile(
        r"if\s+auth_type\s*==|if\s+source_type\s*==|if\s+vendor\s*==|if\s+destination_type\s*==",
        re.IGNORECASE,
    )
    assert pat.search(text) is None


def test_unknown_auth_type_raises_preview_error() -> None:
    with pytest.raises(PreviewRequestError):
        AuthStrategyRegistry.get("NO_SUCH_AUTH")


def test_oauth2_client_credentials_strategy_posts_token_and_sets_bearer() -> None:
    from app.connectors.auth.runtime_extra_strategies import OAuth2ClientCredentialsStrategy

    mock_client = MagicMock()
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json = MagicMock(return_value={"access_token": "okta-mock-access-token"})
    mock_client.post.return_value = mock_resp
    mock_client.__enter__ = MagicMock(return_value=mock_client)
    mock_client.__exit__ = MagicMock(return_value=False)

    strat = OAuth2ClientCredentialsStrategy()
    auth = normalize_connector_auth(
        {
            "auth_type": "oauth2_client_credentials",
            "oauth2_token_url": "http://wiremock/oauth2/default/v1/token",
            "oauth2_client_id": "okta-e2e-client",
            "oauth2_client_secret": "okta-e2e-secret",
            "oauth2_scope": "read",
        }
    )
    with patch("app.connectors.auth.runtime_extra_strategies.httpx.Client", return_value=mock_client):
        h, _p = strat.apply(
            auth,
            {},
            {},
            verify_ssl=True,
            proxy_url=None,
            timeout_seconds=30.0,
            base_url="http://localhost",
        )
    assert h["Authorization"] == "Bearer okta-mock-access-token"
    mock_client.post.assert_called_once()
    _args, kwargs = mock_client.post.call_args
    body = str(kwargs.get("data") or "")
    assert "grant_type=client_credentials" in body
    assert "scope=read" in body
    assert kwargs.get("auth") == ("okta-e2e-client", "okta-e2e-secret")


def test_jwt_refresh_token_strategy_requests_token_url_and_sets_bearer() -> None:
    from app.connectors.auth.runtime_extra_strategies import JwtRefreshTokenAuthStrategy

    mock_client = MagicMock()
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json = MagicMock(return_value={"access_token": "okta-mock-access-token", "expires_in": 300})
    mock_client.request.return_value = mock_resp
    mock_client.__enter__ = MagicMock(return_value=mock_client)
    mock_client.__exit__ = MagicMock(return_value=False)

    strat = JwtRefreshTokenAuthStrategy()
    auth = normalize_connector_auth(
        {
            "auth_type": "jwt_refresh_token",
            "token_url": "http://wiremock/oauth2/lab/refresh",
            "refresh_token": "lab-dev-validation-refresh-token",
        }
    )
    with patch("app.connectors.auth.runtime_extra_strategies.httpx.Client", return_value=mock_client):
        h, _p = strat.apply(
            auth,
            {},
            {},
            verify_ssl=True,
            proxy_url=None,
            timeout_seconds=30.0,
            base_url="http://localhost",
        )
    assert h.get("Authorization") == "Bearer okta-mock-access-token"
    mock_client.request.assert_called_once()
    ca = mock_client.request.call_args
    assert ca.kwargs.get("method") == "POST"
    assert str(ca.kwargs.get("url")) == "http://wiremock/oauth2/lab/refresh"
