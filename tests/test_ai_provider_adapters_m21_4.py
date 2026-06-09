"""Unit tests for M21.4 provider adapters."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from app.ai_providers.adapters.azure_openai import AzureOpenAiProviderAdapter
from app.ai_providers.adapters.claude import ClaudeProviderAdapter
from app.ai_providers.adapters.gemini import GeminiProviderAdapter
from app.ai_providers.adapters.ollama import OllamaProviderAdapter
from app.ai_providers.adapters.registry import AiProviderAdapterRegistry
from app.ai_providers.adapters.types import ProviderHttpRequest
from app.ai_providers.adapters.vllm import VllmProviderAdapter


@pytest.mark.parametrize(
    ("adapter_cls", "provider_type"),
    [
        (AzureOpenAiProviderAdapter, "AZURE_OPENAI"),
        (ClaudeProviderAdapter, "CLAUDE"),
        (GeminiProviderAdapter, "GEMINI"),
        (OllamaProviderAdapter, "OLLAMA"),
        (VllmProviderAdapter, "VLLM"),
    ],
)
def test_registry_registers_m21_4_adapters(adapter_cls: type, provider_type: str) -> None:
    registry = AiProviderAdapterRegistry()
    assert registry.get(provider_type).provider_type == provider_type
    assert isinstance(registry.get(provider_type), adapter_cls)


def test_azure_build_request_uses_deployment_url() -> None:
    adapter = AzureOpenAiProviderAdapter()
    request = adapter.build_http_request(
        {"model": "gpt-4o-deploy", "messages": [{"role": "user", "content": "hi"}]},
        {"endpoint_url": "https://azure.example.com", "default_model": "gpt-4o-deploy", "timeout_seconds": 60},
        {"api_key": "azure-key", "api_version": "2024-02-15-preview"},
    )
    assert "deployments/gpt-4o-deploy/chat/completions" in request.url
    assert request.headers["api-key"] == "azure-key"


def test_claude_build_request_maps_messages() -> None:
    adapter = ClaudeProviderAdapter()
    request = adapter.build_http_request(
        {
            "model": "claude-3-5-sonnet-20241022",
            "messages": [{"role": "user", "content": "hello"}],
            "temperature": 0.5,
        },
        {"endpoint_url": "https://api.anthropic.com", "timeout_seconds": 60},
        {"api_key": "anthropic-key"},
    )
    assert request.url.endswith("/v1/messages")
    assert request.json_body["model"] == "claude-3-5-sonnet-20241022"
    assert request.json_body["messages"][0]["content"] == "hello"


def test_gemini_build_request_maps_contents() -> None:
    adapter = GeminiProviderAdapter()
    request = adapter.build_http_request(
        {"model": "gemini-1.5-flash", "messages": [{"role": "user", "content": "hello"}]},
        {"endpoint_url": "https://generativelanguage.googleapis.com", "timeout_seconds": 60},
        {"api_key": "gemini-key"},
    )
    assert ":generateContent" in request.url
    assert request.json_body["contents"][0]["parts"][0]["text"] == "hello"


def test_ollama_build_request_stream_false() -> None:
    adapter = OllamaProviderAdapter()
    request = adapter.build_http_request(
        {"model": "llama3", "messages": [{"role": "user", "content": "hello"}]},
        {"endpoint_url": "http://127.0.0.1:11434", "timeout_seconds": 60},
        {},
    )
    assert request.url.endswith("/api/chat")
    assert request.json_body["stream"] is False


def test_vllm_build_request_openai_compatible() -> None:
    adapter = VllmProviderAdapter()
    request = adapter.build_http_request(
        {"model": "meta-llama/Meta-Llama-3-8B-Instruct", "messages": [{"role": "user", "content": "hello"}]},
        {"endpoint_url": "http://127.0.0.1:8000", "timeout_seconds": 60},
        {"bearer_token": "vllm-token"},
    )
    assert request.url.endswith("/v1/chat/completions")
    assert request.json_body["stream"] is False
    assert request.headers["Authorization"] == "Bearer vllm-token"


def _mock_http_client(monkeypatch: pytest.MonkeyPatch, module: str, payload: dict[str, Any]) -> None:
    class _Response:
        status_code = 200
        content = b"{}"

        def json(self) -> dict[str, Any]:
            return payload

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

        def post(self, *args: Any, **kwargs: Any) -> _Response:
            _ = args, kwargs
            return _Response()

    monkeypatch.setattr(f"{module}.httpx.Client", _Client)


def test_claude_send_request_parses_content(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_http_client(
        monkeypatch,
        "app.ai_providers.adapters.claude",
        {"id": "msg-1", "model": "claude-3-5-sonnet-20241022", "content": [{"type": "text", "text": "Hi"}]},
    )
    adapter = ClaudeProviderAdapter()
    request = ProviderHttpRequest(
        method="POST",
        url="https://api.anthropic.com/v1/messages",
        headers={"x-api-key": "k"},
        json_body={"model": "claude-3-5-sonnet-20241022", "messages": [{"role": "user", "content": "hello"}]},
        timeout_seconds=30.0,
    )
    result = adapter.send_request(request, timeout_seconds=30.0)
    assert result.success is True
    assert result.normalized_response["provider"] == "CLAUDE"
