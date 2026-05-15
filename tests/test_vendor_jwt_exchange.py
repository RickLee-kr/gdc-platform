"""Tests for vendor_jwt_exchange (Stellar Cyber-style Basic token exchange + Bearer API calls)."""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app


def test_stream_api_test_vendor_uses_bearer_after_exchange(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str]] = []

    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, *a: object) -> bool:
            return False

        def request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
            calls.append((method.upper(), str(url)))
            req = httpx.Request(method, url)
            if str(url).endswith("/token"):
                return httpx.Response(200, request=req, json={"access_token": "exchanged-token"})
            return httpx.Response(200, request=req, json={"ok": True})

    monkeypatch.setattr("app.connectors.auth_execute.httpx.Client", lambda *a, **k: _Client())
    tc = TestClient(app)

    response = tc.post(
        "/api/v1/runtime/api-test/http",
        json={
            "source_config": {
                "base_url": "https://api.vendor.example.com",
                "auth_type": "vendor_jwt_exchange",
                "user_id": "u1",
                "api_key": "k1",
                "token_url": "https://api.vendor.example.com/token",
                "token_method": "POST",
                "token_auth_mode": "basic_user_id_api_key",
                "token_path": "$.access_token",
            },
            "stream_config": {"method": "GET", "endpoint": "/alerts"},
        },
    )
    assert response.status_code == 200
    assert len(calls) == 2
    assert calls[0][0] == "POST" and "token" in calls[0][1]
    assert calls[1][0] == "GET" and "/alerts" in calls[1][1]


def test_connector_auth_before_save_vendor_exchange(monkeypatch: pytest.MonkeyPatch) -> None:
    """Connector Auth Test (preview) applies vendor exchange via _apply_auth_to_request."""

    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, *a: object) -> bool:
            return False

        def request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
            req = httpx.Request(method, url)
            if "exchange" in str(url):
                return httpx.Response(200, request=req, json={"access_token": "pre-save-token"})
            return httpx.Response(200, request=req, json={"probe": True})

    monkeypatch.setattr("app.runtime.preview_service.httpx.Client", lambda *a, **k: _Client())
    tc = TestClient(app)

    r = tc.post(
        "/api/v1/runtime/api-test/connector-auth",
        json={
            "inline_flat_source": {
                "base_url": "https://probe.example.com",
                "headers": {},
                "auth_type": "vendor_jwt_exchange",
                "user_id": "uid",
                "api_key": "secret",
                "token_url": "https://probe.example.com/exchange",
                "token_method": "POST",
                "token_auth_mode": "basic_user_id_api_key",
                "token_path": "$.access_token",
            },
            "method": "GET",
            "test_path": "/v1/status",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    masked = body.get("request_headers_masked") or {}
    auth = masked.get("Authorization") or masked.get("authorization")
    assert auth == "********"
