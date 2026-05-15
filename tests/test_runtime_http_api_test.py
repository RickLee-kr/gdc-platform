from __future__ import annotations

import base64

import httpx
import pytest

from app.runtime.preview_service import (
    PreviewRequestError,
    _apply_auth_to_request,
    run_http_api_test,
)
from app.runtime.schemas import HttpApiTestRequest

_HTTPX_CLIENT = "app.connectors.auth_execute.httpx.Client"


class _FakeClient:
    def __init__(self, responses: list[httpx.Response]):
        self._responses = responses

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def request(self, method: str, url: str, **kwargs):
        _ = (method, url, kwargs)
        return self._responses.pop(0)

    def post(self, url: str, **kwargs):
        _ = (url, kwargs)
        return self._responses.pop(0)


def _httpx_response(method: str, url: str, status_code: int, *, json_body=None, text_body: str | None = None):
    request = httpx.Request(method, url)
    if json_body is not None:
        return httpx.Response(status_code=status_code, request=request, json=json_body)
    return httpx.Response(status_code=status_code, request=request, text=text_body or "")


def test_run_http_api_test_success_returns_metadata(monkeypatch: pytest.MonkeyPatch):
    response = _httpx_response(
        "GET",
        "https://example.test/v1/events",
        200,
        json_body={"data": {"events": [{"id": "a-1"}]}},
    )
    monkeypatch.setattr(
        _HTTPX_CLIENT,
        lambda *args, **kwargs: _FakeClient([response]),
    )
    payload = HttpApiTestRequest(
        source_config={"base_url": "https://example.test"},
        stream_config={"method": "GET", "endpoint": "/v1/events", "event_array_path": "data.events"},
    )
    result = run_http_api_test(payload)
    assert result.ok is True
    assert result.request.url == "https://example.test/v1/events"
    assert result.response is not None
    assert result.response.status_code == 200
    assert isinstance(result.response.headers, dict)
    assert result.analysis is not None
    assert any(x.path == "$.data.events" for x in result.analysis.detected_arrays)


def test_run_http_api_test_http_status_failure(monkeypatch: pytest.MonkeyPatch):
    response = _httpx_response(
        "GET",
        "https://example.test/v1/events",
        500,
        json_body={"error": "boom"},
    )
    monkeypatch.setattr(
        _HTTPX_CLIENT,
        lambda *args, **kwargs: _FakeClient([response]),
    )
    payload = HttpApiTestRequest(
        source_config={"base_url": "https://example.test"},
        stream_config={"method": "GET", "endpoint": "/v1/events"},
    )
    with pytest.raises(PreviewRequestError) as exc:
        run_http_api_test(payload)
    assert exc.value.detail["error_type"] == "target_http_error"
    assert exc.value.detail["target_status_code"] == 500


@pytest.mark.parametrize(
    ("auth", "expected_header", "expected_param"),
    [
        ({"auth_type": "NO_AUTH"}, None, None),
        (
            {"auth_type": "BASIC", "username": "alice", "password": "pw"},
            f"Basic {base64.b64encode(b'alice:pw').decode('utf-8')}",
            None,
        ),
        ({"auth_type": "BEARER", "token": "token-1"}, "Bearer token-1", None),
        (
            {"auth_type": "API_KEY", "api_key_name": "X-Api-Key", "api_key_value": "k1", "api_key_location": "headers"},
            "k1",
            None,
        ),
        (
            {"auth_type": "API_KEY", "api_key_name": "api_key", "api_key_value": "k2", "api_key_location": "query_params"},
            None,
            "k2",
        ),
    ],
)
def test_apply_auth_variants(auth: dict, expected_header: str | None, expected_param: str | None):
    headers, params = _apply_auth_to_request(
        auth,
        headers={},
        params={},
        verify_ssl=True,
        proxy_url=None,
        timeout_seconds=10,
        base_url="https://example.test",
    )
    if auth["auth_type"] == "API_KEY" and auth.get("api_key_location") == "headers":
        assert headers.get("X-Api-Key") == expected_header
    elif auth["auth_type"] in {"BASIC", "BEARER"}:
        assert headers.get("Authorization") == expected_header
    if auth["auth_type"] == "API_KEY" and auth.get("api_key_location") == "query_params":
        assert params.get("api_key") == expected_param


def test_run_http_api_test_target_401_error_type(monkeypatch: pytest.MonkeyPatch):
    response = _httpx_response("GET", "https://example.test/v1/events", 401, text_body="unauthorized")
    monkeypatch.setattr(_HTTPX_CLIENT, lambda *args, **kwargs: _FakeClient([response]))
    payload = HttpApiTestRequest(source_config={"base_url": "https://example.test"}, stream_config={"method": "GET", "endpoint": "/v1/events"})
    with pytest.raises(PreviewRequestError) as exc:
        run_http_api_test(payload)
    assert exc.value.detail["error_type"] == "target_401_unauthorized"
    assert exc.value.detail["target_status_code"] == 401


def test_run_http_api_test_target_404_error_type(monkeypatch: pytest.MonkeyPatch):
    response = _httpx_response("GET", "https://example.test/v1/missing", 404, text_body="not found")
    monkeypatch.setattr(_HTTPX_CLIENT, lambda *args, **kwargs: _FakeClient([response]))
    payload = HttpApiTestRequest(source_config={"base_url": "https://example.test"}, stream_config={"method": "GET", "endpoint": "/v1/missing"})
    with pytest.raises(PreviewRequestError) as exc:
        run_http_api_test(payload)
    assert exc.value.detail["error_type"] == "target_404_not_found"
    assert exc.value.detail["target_status_code"] == 404


def test_run_http_api_test_invalid_json_body():
    payload = HttpApiTestRequest(
        source_config={"base_url": "https://example.test"},
        stream_config={"method": "POST", "endpoint": "/v1/events", "body": "{bad json}"},
    )
    with pytest.raises(PreviewRequestError) as exc:
        run_http_api_test(payload)
    assert exc.value.detail["error_type"] == "invalid_json_body"


def test_run_http_api_test_jwt_refresh_failure(monkeypatch: pytest.MonkeyPatch):
    token_response = _httpx_response("POST", "https://example.test/token", 200, json_body={"missing": "token"})
    monkeypatch.setattr(_HTTPX_CLIENT, lambda *args, **kwargs: _FakeClient([token_response]))
    payload = HttpApiTestRequest(
        source_config={
            "base_url": "https://example.test",
            "auth_type": "jwt_refresh_token",
            "refresh_token": "refresh",
            "token_url": "https://example.test/token",
        },
        stream_config={"method": "GET", "endpoint": "/v1/events"},
    )
    with pytest.raises(PreviewRequestError) as exc:
        run_http_api_test(payload)
    assert exc.value.detail["error_type"] == "access_token_not_found"
    assert exc.value.detail.get("error_code") == "access_token_not_found"


def test_run_http_api_test_oauth2_client_credentials_two_requests(monkeypatch: pytest.MonkeyPatch):
    token_resp = _httpx_response(
        "POST",
        "https://example.test/oauth/token",
        200,
        json_body={"access_token": "oauth-access-xyz", "token_type": "Bearer"},
    )
    resource_resp = _httpx_response(
        "GET",
        "https://example.test/v1/resource",
        200,
        json_body={"ok": True, "via": "oauth2"},
    )
    monkeypatch.setattr(_HTTPX_CLIENT, lambda *args, **kwargs: _FakeClient([token_resp, resource_resp]))
    result = run_http_api_test(
        HttpApiTestRequest(
            source_config={
                "base_url": "https://example.test",
                "auth_type": "oauth2_client_credentials",
                "oauth2_token_url": "https://example.test/oauth/token",
                "oauth2_client_id": "test-client",
                "oauth2_client_secret": "test-secret",
            },
            stream_config={"method": "GET", "endpoint": "/v1/resource"},
        )
    )
    assert result.ok is True
    assert result.response and result.response.parsed_json == {"ok": True, "via": "oauth2"}
    assert [s.name for s in result.steps] == ["token_request", "target_request"]


def test_run_http_api_test_invalid_json_response_body(monkeypatch: pytest.MonkeyPatch):
    req = httpx.Request("GET", "https://example.test/v1/events")
    response = httpx.Response(
        200,
        request=req,
        text="{not-json",
        headers={"content-type": "application/json; charset=utf-8"},
    )
    monkeypatch.setattr(_HTTPX_CLIENT, lambda *args, **kwargs: _FakeClient([response]))
    payload = HttpApiTestRequest(
        source_config={"base_url": "https://example.test"},
        stream_config={"method": "GET", "endpoint": "/v1/events"},
    )
    with pytest.raises(PreviewRequestError) as exc:
        run_http_api_test(payload)
    assert exc.value.detail.get("error_code") == "invalid_json_response"


def test_run_http_api_test_unsupported_content_type(monkeypatch: pytest.MonkeyPatch):
    req = httpx.Request("GET", "https://example.test/v1/events")
    response = httpx.Response(
        200,
        request=req,
        text="not json at all",
        headers={"content-type": "text/plain"},
    )
    monkeypatch.setattr(_HTTPX_CLIENT, lambda *args, **kwargs: _FakeClient([response]))
    payload = HttpApiTestRequest(
        source_config={"base_url": "https://example.test"},
        stream_config={"method": "GET", "endpoint": "/v1/events"},
    )
    with pytest.raises(PreviewRequestError) as exc:
        run_http_api_test(payload)
    assert exc.value.detail.get("error_code") == "unsupported_content_type"


def test_run_http_api_test_fetch_sample_flag_does_not_inject_limit(monkeypatch: pytest.MonkeyPatch):
    """GET Fetch Sample must not add ?limit= — Elasticsearch-style APIs reject unknown query params."""

    captured: dict[str, dict] = {}

    class _CaptureClient:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def request(self, method: str, url: str, **kwargs):
            captured["request"] = kwargs
            req = httpx.Request(method, url)
            return httpx.Response(200, request=req, json={"hits": {"hits": []}})

    monkeypatch.setattr(_HTTPX_CLIENT, lambda *args, **kwargs: _CaptureClient())
    payload = HttpApiTestRequest(
        source_config={"base_url": "https://example.test"},
        stream_config={"method": "GET", "endpoint": "/connect/api/data/aella-ser-*/_search", "params": {}},
        fetch_sample=True,
    )
    result = run_http_api_test(payload)
    assert result.ok is True
    params = captured["request"].get("params")
    assert params is None or (isinstance(params, dict) and "limit" not in params)


def test_run_http_api_test_header_and_query_merge(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, dict] = {}

    class _CaptureClient:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def request(self, method: str, url: str, **kwargs):
            captured["request"] = kwargs
            req = httpx.Request(method, url)
            return httpx.Response(200, request=req, json={"ok": True})

        def post(self, url: str, **kwargs):
            req = httpx.Request("POST", url)
            return httpx.Response(200, request=req, json={"access_token": "x"})

    monkeypatch.setattr(_HTTPX_CLIENT, lambda *args, **kwargs: _CaptureClient())
    payload = HttpApiTestRequest(
        source_config={"base_url": "https://example.test", "common_headers": {"X-Shared": "A"}},
        stream_config={"method": "GET", "endpoint": "/v1/events", "headers": {"X-Shared": "B"}, "params": {"limit": "10"}},
    )
    result = run_http_api_test(payload)
    assert result.ok is True
    assert captured["request"]["headers"]["X-Shared"] == "B"
    assert captured["request"]["params"]["limit"] == "10"


def test_run_http_api_test_get_body_size_is_sent_and_not_overridden_by_limit(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, dict] = {}

    class _CaptureClient:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def request(self, method: str, url: str, **kwargs):
            captured["method"] = method
            captured["url"] = url
            captured["request"] = kwargs
            req = httpx.Request(method, url)
            return httpx.Response(
                200,
                request=req,
                json={"hits": {"hits": [{"_id": "evt-1"}]}},
            )

    monkeypatch.setattr(_HTTPX_CLIENT, lambda *args, **kwargs: _CaptureClient())
    payload = HttpApiTestRequest(
        source_config={"base_url": "https://example.test"},
        stream_config={
            "method": "GET",
            "endpoint": "/_search",
            "params": {"limit": "10"},
            "body": {"size": 1, "query": {"bool": {"filter": []}}},
        },
        fetch_sample=True,
    )

    result = run_http_api_test(payload)

    assert result.ok is True
    assert captured["method"] == "GET"
    assert captured["request"]["params"]["limit"] == "10"
    assert captured["request"]["json"]["size"] == 1
    assert "limit" not in captured["request"]["json"]
    assert result.actual_request_sent is not None
    assert result.actual_request_sent.query_params.get("limit") == "10"
    assert isinstance(result.actual_request_sent.json_body_masked, dict)
    assert result.actual_request_sent.json_body_masked.get("size") == 1


def test_run_http_api_test_actual_request_sent_masks_header_secrets(monkeypatch: pytest.MonkeyPatch):
    class _CaptureClient:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def request(self, method: str, url: str, **kwargs):
            req = httpx.Request(method, url)
            return httpx.Response(200, request=req, json={"ok": True})

    monkeypatch.setattr(_HTTPX_CLIENT, lambda *args, **kwargs: _CaptureClient())
    payload = HttpApiTestRequest(
        source_config={
            "base_url": "https://example.test",
            "headers": {"Authorization": "Bearer super-secret-token"},
        },
        stream_config={"method": "POST", "endpoint": "/v1/events", "body": {"size": 1}},
    )

    result = run_http_api_test(payload)
    assert result.ok is True
    assert result.actual_request_sent is not None
    assert result.actual_request_sent.headers_masked.get("Authorization") == "********"
