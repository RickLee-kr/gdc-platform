"""vLLM OpenAI-compatible chat completions provider adapter."""

from __future__ import annotations

import time
from typing import Any

import httpx

from app.ai_providers.adapters.base import AiProviderAdapter
from app.ai_providers.adapters.http_common import build_send_result, execute_provider_http, raise_on_http_error
from app.ai_providers.adapters.types import CredentialProbeResult, ProviderHttpRequest, ProviderSendResult
from app.http.outbound_httpx_timeout import outbound_httpx_timeout

DEFAULT_MODEL = "meta-llama/Meta-Llama-3-8B-Instruct"


def _chat_completions_url(endpoint_url: str) -> str:
    base = str(endpoint_url or "").strip().rstrip("/")
    if base.endswith("/v1/chat/completions"):
        return base
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


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
    token = str((auth_json or {}).get("bearer_token") or (auth_json or {}).get("api_key") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


class VllmProviderAdapter(AiProviderAdapter):
    @property
    def provider_type(self) -> str:
        return "VLLM"

    def validate_credentials(
        self,
        provider_config: dict[str, Any],
        auth_json: dict[str, Any],
        *,
        timeout_seconds: float,
    ) -> CredentialProbeResult:
        started = time.perf_counter()
        url = _chat_completions_url(str(provider_config.get("endpoint_url") or ""))
        body = {
            "model": _resolve_model({}, provider_config),
            "messages": [{"role": "user", "content": "ping"}],
            "max_tokens": 1,
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
        body = dict(provider_request or {})
        body["model"] = _resolve_model(provider_request, provider_config)
        body["stream"] = False
        timeout = float(provider_config.get("timeout_seconds") or 120)
        return ProviderHttpRequest(
            method="POST",
            url=_chat_completions_url(str(provider_config.get("endpoint_url") or "")),
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
        raise_on_http_error(response, provider_label="VLLM")
        payload = response.json() if response.content else {}
        content = ""
        if isinstance(payload, dict):
            choices = payload.get("choices")
            if isinstance(choices, list) and choices:
                message = choices[0].get("message") if isinstance(choices[0], dict) else None
                if isinstance(message, dict):
                    content = str(message.get("content") or "")
        model = str(payload.get("model") or request.json_body.get("model") or "") if isinstance(payload, dict) else ""
        return build_send_result(
            response=response,
            latency_ms=latency_ms,
            provider_label="VLLM",
            model=model,
            content=content,
        )
