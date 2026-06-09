"""Unit tests for AI provider adapters and registry (M21.2)."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from app.ai_providers.adapters.mock import MockProviderAdapter
from app.ai_providers.adapters.openai import OpenAiProviderAdapter
from app.ai_providers.adapters.registry import AiProviderAdapterRegistry, get_ai_provider_adapter_registry
from app.ai_providers.adapters.types import ProviderHttpRequest
from app.ai_providers.retry import should_retry_ai_provider_error
from app.runtime.errors import DestinationSendError


def test_registry_returns_mock_and_openai() -> None:
    registry = AiProviderAdapterRegistry()
    assert registry.get("MOCK").provider_type == "MOCK"
    assert registry.get("openai").provider_type == "OPENAI"
    with pytest.raises(DestinationSendError):
        registry.get("UNKNOWN")


def test_singleton_registry() -> None:
    assert get_ai_provider_adapter_registry().get("MOCK") is not None


def test_mock_provider_deterministic_response() -> None:
    adapter = MockProviderAdapter()
    request = adapter.build_http_request(
        {"model": "mock-model", "messages": [{"role": "user", "content": "hi"}]},
        {"endpoint_url": "mock://local", "timeout_seconds": 30},
        {},
    )
    result = adapter.send_request(request, timeout_seconds=30.0)
    assert result.success is True
    assert result.normalized_response["id"] == "mock-response"
    assert result.normalized_response["provider"] == "MOCK"
    assert result.normalized_response["content"] == "Mock response"


def test_openai_build_request_requires_supported_model() -> None:
    adapter = OpenAiProviderAdapter()
    with pytest.raises(ValueError, match="unsupported OpenAI model"):
        adapter.build_http_request(
            {"model": "gpt-5", "messages": [{"role": "user", "content": "hi"}]},
            {"endpoint_url": "http://example.com", "timeout_seconds": 30},
            {"api_key": "sk-test"},
        )


def test_openai_build_request_url_and_headers() -> None:
    adapter = OpenAiProviderAdapter()
    request = adapter.build_http_request(
        {"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}]},
        {"endpoint_url": "http://wiremock/openai", "timeout_seconds": 60},
        {"api_key": "sk-test"},
    )
    assert request.url == "http://wiremock/openai/v1/chat/completions"
    assert request.headers["Authorization"] == "Bearer sk-test"
    assert request.json_body["model"] == "gpt-4o"
    assert request.json_body["stream"] is False


def test_openai_send_request_parses_completion(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = OpenAiProviderAdapter()

    class _Response:
        status_code = 200
        content = b'{"id":"cmpl-1","model":"gpt-4o","choices":[{"message":{"content":"Hello"}}]}'

        def json(self) -> dict[str, Any]:
            return {
                "id": "cmpl-1",
                "model": "gpt-4o",
                "choices": [{"message": {"content": "Hello"}}],
            }

    class _Client:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            _ = args, kwargs

        def __enter__(self) -> _Client:
            return self

        def __exit__(self, *args: Any) -> None:
            _ = args

        def request(self, *args: Any, **kwargs: Any) -> _Response:
            _ = args, kwargs
            return _Response()

    monkeypatch.setattr("app.ai_providers.adapters.openai.httpx.Client", _Client)
    request = ProviderHttpRequest(
        method="POST",
        url="http://example.com/v1/chat/completions",
        headers={"Authorization": "Bearer sk-test"},
        json_body={"model": "gpt-4o", "messages": []},
        timeout_seconds=30.0,
    )
    result = adapter.send_request(request, timeout_seconds=30.0)
    assert result.success is True
    assert result.provider_response_id == "cmpl-1"
    assert result.normalized_response["content"] == "Hello"


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (400, False),
        (401, False),
        (404, False),
        (429, True),
        (500, True),
        (503, True),
        (None, True),
    ],
)
def test_retry_policy(status: int | None, expected: bool) -> None:
    if status is None:
        err: Exception = httpx.TimeoutException("timeout")
    else:
        err = DestinationSendError("fail", http_status=status)
    assert should_retry_ai_provider_error(err) is expected
