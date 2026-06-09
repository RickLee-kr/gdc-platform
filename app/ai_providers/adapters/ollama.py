"""Ollama chat API provider adapter."""

from __future__ import annotations

import time
from typing import Any

import httpx

from app.ai_providers.adapters.base import AiProviderAdapter
from app.ai_providers.adapters.http_common import build_send_result, execute_provider_http, raise_on_http_error
from app.ai_providers.adapters.types import CredentialProbeResult, ProviderHttpRequest, ProviderSendResult
from app.http.outbound_httpx_timeout import outbound_httpx_timeout

DEFAULT_MODEL = "llama3"


def _chat_url(endpoint_url: str) -> str:
    base = str(endpoint_url or "").strip().rstrip("/")
    if base.endswith("/api/chat"):
        return base
    return f"{base}/api/chat"


def _resolve_model(provider_request: dict[str, Any], provider_config: dict[str, Any]) -> str:
    override = provider_config.get("model_override")
    if override:
        return str(override).strip()
    model = str((provider_request or {}).get("model") or "").strip()
    if model:
        return model
    default_model = str(provider_config.get("default_model") or "").strip()
    return default_model or DEFAULT_MODEL


def _headers(auth_json: dict[str, Any]) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    token = str((auth_json or {}).get("bearer_token") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


class OllamaProviderAdapter(AiProviderAdapter):
    @property
    def provider_type(self) -> str:
        return "OLLAMA"

    def validate_credentials(
        self,
        provider_config: dict[str, Any],
        auth_json: dict[str, Any],
        *,
        timeout_seconds: float,
    ) -> CredentialProbeResult:
        started = time.perf_counter()
        url = _chat_url(str(provider_config.get("endpoint_url") or ""))
        body = {
            "model": _resolve_model({}, provider_config),
            "messages": [{"role": "user", "content": "ping"}],
            "stream": False,
        }
        try:
            httpx_timeout = outbound_httpx_timeout(timeout_seconds)
            with httpx.Client(timeout=httpx_timeout) as client:
                response = client.post(url, headers=_headers(auth_json), json=body)
            latency = round((time.perf_counter() - started) * 1000.0, 3)
            ok = 200 <= response.status_code < 300
            return CredentialProbeResult(
                ok=ok,
                latency_ms=latency,
                message=f"HTTP {response.status_code}",
                http_status=int(response.status_code),
            )
        except httpx.HTTPError as exc:
            return CredentialProbeResult(
                ok=False,
                latency_ms=round((time.perf_counter() - started) * 1000.0, 3),
                message=str(exc),
            )

    def list_models(
        self,
        provider_config: dict[str, Any],
        auth_json: dict[str, Any],
        *,
        timeout_seconds: float,
    ) -> list[str]:
        _ = auth_json, timeout_seconds
        return [_resolve_model({}, provider_config)]

    def build_http_request(
        self,
        provider_request: dict[str, Any],
        provider_config: dict[str, Any],
        auth_json: dict[str, Any],
    ) -> ProviderHttpRequest:
        body = {
            "model": _resolve_model(provider_request, provider_config),
            "messages": provider_request.get("messages") or [],
            "stream": False,
        }
        if provider_request.get("temperature") is not None:
            body["options"] = {"temperature": float(provider_request.get("temperature"))}
        timeout = float(provider_config.get("timeout_seconds") or 120)
        return ProviderHttpRequest(
            method="POST",
            url=_chat_url(str(provider_config.get("endpoint_url") or "")),
            headers=_headers(auth_json),
            json_body=body,
            timeout_seconds=timeout,
        )

    def send_request(
        self,
        request: ProviderHttpRequest,
        *,
        timeout_seconds: float,
    ) -> ProviderSendResult:
        response, latency_ms = execute_provider_http(
            request.method,
            request.url,
            headers=request.headers,
            json_body=request.json_body,
            timeout_seconds=timeout_seconds,
        )
        raise_on_http_error(response, provider_label="OLLAMA")
        payload = response.json() if response.content else {}
        content = ""
        if isinstance(payload, dict):
            message = payload.get("message")
            if isinstance(message, dict):
                content = str(message.get("content") or "")
        model = str(request.json_body.get("model") or "")
        return build_send_result(
            response=response,
            latency_ms=latency_ms,
            provider_label="OLLAMA",
            model=model,
            content=content,
        )
