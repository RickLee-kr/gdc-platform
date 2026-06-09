"""OpenAI Chat Completions provider adapter (HTTP API, non-streaming)."""

from __future__ import annotations

import threading
import time
from typing import Any

import httpx

from app.ai_providers.adapters.base import AiProviderAdapter
from app.ai_providers.adapters.types import (
    CredentialProbeResult,
    ProviderHttpRequest,
    ProviderSendResult,
)
from app.ai_providers.schemas import OPENAI_MODELS
from app.http.outbound_httpx_timeout import outbound_httpx_timeout
from app.runtime.errors import DestinationSendError

_openai_pool_lock = threading.Lock()
_openai_pool: dict[str, httpx.Client] = {}


def _borrow_openai_client(*, pool_key: str, timeout: httpx.Timeout) -> httpx.Client:
    with _openai_pool_lock:
        client = _openai_pool.get(pool_key)
        if (
            client is None
            or getattr(client, "is_closed", False)
            or not isinstance(client, httpx.Client)
        ):
            client = httpx.Client(timeout=timeout)
            _openai_pool[pool_key] = client
        return client


def _invalidate_openai_client(pool_key: str) -> None:
    with _openai_pool_lock:
        client = _openai_pool.pop(pool_key, None)
    if client is not None and not getattr(client, "is_closed", False):
        client.close()


def _chat_completions_url(endpoint_url: str) -> str:
    base = str(endpoint_url or "").strip().rstrip("/")
    if base.endswith("/v1/chat/completions"):
        return base
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def _resolve_model(provider_request: dict[str, Any], provider_config: dict[str, Any]) -> str:
    for key in ("model_override",):
        override = provider_config.get(key)
        if override:
            return str(override).strip()
    model = str((provider_request or {}).get("model") or "").strip()
    if model:
        return model
    default_model = str(provider_config.get("default_model") or "").strip()
    if default_model:
        return default_model
    raise ValueError("provider_request.model is required for OPENAI")


def _openai_headers(auth_json: dict[str, Any]) -> dict[str, str]:
    api_key = str((auth_json or {}).get("api_key") or "").strip()
    if not api_key:
        raise ValueError("OPENAI provider requires auth_json.api_key")
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


class OpenAiProviderAdapter(AiProviderAdapter):
    @property
    def provider_type(self) -> str:
        return "OPENAI"

    def validate_credentials(
        self,
        provider_config: dict[str, Any],
        auth_json: dict[str, Any],
        *,
        timeout_seconds: float,
    ) -> CredentialProbeResult:
        started = time.perf_counter()
        try:
            headers = _openai_headers(auth_json)
        except ValueError as exc:
            return CredentialProbeResult(
                ok=False,
                latency_ms=round((time.perf_counter() - started) * 1000.0, 3),
                message=str(exc),
            )
        url = _chat_completions_url(str(provider_config.get("endpoint_url") or ""))
        body = {
            "model": str(provider_config.get("default_model") or OPENAI_MODELS[0]),
            "messages": [{"role": "user", "content": "ping"}],
            "max_tokens": 1,
            "stream": False,
        }
        try:
            httpx_timeout = outbound_httpx_timeout(timeout_seconds)
            with httpx.Client(timeout=httpx_timeout) as client:
                response = client.post(url, headers=headers, json=body)
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
        _ = provider_config, auth_json, timeout_seconds
        return list(OPENAI_MODELS)

    def build_http_request(
        self,
        provider_request: dict[str, Any],
        provider_config: dict[str, Any],
        auth_json: dict[str, Any],
    ) -> ProviderHttpRequest:
        model = _resolve_model(provider_request, provider_config)
        if model not in OPENAI_MODELS:
            raise ValueError(f"unsupported OpenAI model: {model}")
        body = dict(provider_request or {})
        body["model"] = model
        body["stream"] = False
        timeout = float(provider_config.get("timeout_seconds") or 120)
        return ProviderHttpRequest(
            method="POST",
            url=_chat_completions_url(str(provider_config.get("endpoint_url") or "")),
            headers=_openai_headers(auth_json),
            json_body=body,
            timeout_seconds=timeout,
        )

    def send_request(
        self,
        request: ProviderHttpRequest,
        *,
        timeout_seconds: float,
    ) -> ProviderSendResult:
        started = time.perf_counter()
        httpx_timeout = outbound_httpx_timeout(timeout_seconds)
        pool_key = f"openai:{request.url}"
        client = _borrow_openai_client(pool_key=pool_key, timeout=httpx_timeout)
        try:
            response = client.request(
                request.method,
                request.url,
                headers=request.headers,
                json=request.json_body,
            )
        except httpx.TimeoutException as exc:
            _invalidate_openai_client(pool_key)
            raise DestinationSendError(f"OpenAI request timed out: {exc}") from exc
        except httpx.HTTPError as exc:
            _invalidate_openai_client(pool_key)
            raise DestinationSendError(f"OpenAI request failed: {exc}") from exc

        latency_ms = int(round((time.perf_counter() - started) * 1000.0))
        if response.status_code >= 400:
            raise DestinationSendError(
                f"OpenAI HTTP {response.status_code}",
                http_status=int(response.status_code),
            )

        payload = response.json() if response.content else {}
        response_id = str(payload.get("id") or "") or None
        content = ""
        choices = payload.get("choices")
        if isinstance(choices, list) and choices:
            message = choices[0].get("message") if isinstance(choices[0], dict) else None
            if isinstance(message, dict):
                content = str(message.get("content") or "")
        normalized = {
            "id": response_id or "openai-response",
            "provider": "OPENAI",
            "model": str(payload.get("model") or request.json_body.get("model") or ""),
            "content": content,
            "raw": payload,
        }
        return ProviderSendResult(
            success=True,
            status_code=int(response.status_code),
            latency_ms=latency_ms,
            provider_response_id=response_id,
            normalized_response=normalized,
        )
