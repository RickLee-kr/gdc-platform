"""Anthropic Claude Messages API provider adapter."""

from __future__ import annotations

import time
from typing import Any

import httpx

from app.ai_providers.adapters.base import AiProviderAdapter
from app.ai_providers.adapters.http_common import build_send_result, execute_provider_http, raise_on_http_error
from app.ai_providers.adapters.types import CredentialProbeResult, ProviderHttpRequest, ProviderSendResult
from app.http.outbound_httpx_timeout import outbound_httpx_timeout

DEFAULT_ANTHROPIC_VERSION = "2023-06-01"
DEFAULT_MODEL = "claude-3-5-sonnet-20241022"


def _messages_url(endpoint_url: str) -> str:
    base = str(endpoint_url or "").strip().rstrip("/")
    if base.endswith("/v1/messages"):
        return base
    if base.endswith("/v1"):
        return f"{base}/messages"
    return f"{base}/v1/messages"


def _resolve_model(provider_request: dict[str, Any], provider_config: dict[str, Any]) -> str:
    override = provider_config.get("model_override")
    if override:
        return str(override).strip()
    model = str((provider_request or {}).get("model") or "").strip()
    if model:
        return model
    default_model = str(provider_config.get("default_model") or "").strip()
    return default_model or DEFAULT_MODEL


def _anthropic_headers(auth_json: dict[str, Any]) -> dict[str, str]:
    api_key = str((auth_json or {}).get("api_key") or "").strip()
    if not api_key:
        raise ValueError("CLAUDE provider requires auth_json.api_key")
    version = str((auth_json or {}).get("anthropic_version") or DEFAULT_ANTHROPIC_VERSION)
    return {
        "x-api-key": api_key,
        "anthropic-version": version,
        "Content-Type": "application/json",
    }


def _to_anthropic_body(provider_request: dict[str, Any], model: str) -> dict[str, Any]:
    messages = provider_request.get("messages") if isinstance(provider_request.get("messages"), list) else []
    system_parts: list[str] = []
    converted: list[dict[str, Any]] = []
    for item in messages:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "user")
        content = str(item.get("content") or "")
        if role == "system":
            system_parts.append(content)
            continue
        converted.append({"role": "user" if role == "user" else "assistant", "content": content})
    body: dict[str, Any] = {
        "model": model,
        "messages": converted or [{"role": "user", "content": "ping"}],
        "max_tokens": int(provider_request.get("max_tokens") or 1024),
    }
    if system_parts:
        body["system"] = "\n".join(system_parts)
    temperature = provider_request.get("temperature")
    if temperature is not None:
        body["temperature"] = float(temperature)
    return body


class ClaudeProviderAdapter(AiProviderAdapter):
    @property
    def provider_type(self) -> str:
        return "CLAUDE"

    def validate_credentials(
        self,
        provider_config: dict[str, Any],
        auth_json: dict[str, Any],
        *,
        timeout_seconds: float,
    ) -> CredentialProbeResult:
        started = time.perf_counter()
        try:
            headers = _anthropic_headers(auth_json)
        except ValueError as exc:
            return CredentialProbeResult(ok=False, latency_ms=0, message=str(exc))
        url = _messages_url(str(provider_config.get("endpoint_url") or ""))
        body = _to_anthropic_body({}, _resolve_model({}, provider_config))
        body["max_tokens"] = 1
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
        _ = auth_json, timeout_seconds
        default_model = str(provider_config.get("default_model") or DEFAULT_MODEL).strip()
        return [default_model]

    def build_http_request(
        self,
        provider_request: dict[str, Any],
        provider_config: dict[str, Any],
        auth_json: dict[str, Any],
    ) -> ProviderHttpRequest:
        model = _resolve_model(provider_request, provider_config)
        timeout = float(provider_config.get("timeout_seconds") or 120)
        return ProviderHttpRequest(
            method="POST",
            url=_messages_url(str(provider_config.get("endpoint_url") or "")),
            headers=_anthropic_headers(auth_json),
            json_body=_to_anthropic_body(provider_request, model),
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
        raise_on_http_error(response, provider_label="CLAUDE")
        payload = response.json() if response.content else {}
        content = ""
        if isinstance(payload, dict):
            blocks = payload.get("content")
            if isinstance(blocks, list) and blocks:
                first = blocks[0]
                if isinstance(first, dict):
                    content = str(first.get("text") or "")
        model = str(payload.get("model") or request.json_body.get("model") or "") if isinstance(payload, dict) else ""
        response_id = str(payload.get("id") or "") if isinstance(payload, dict) else None
        return build_send_result(
            response=response,
            latency_ms=latency_ms,
            provider_label="CLAUDE",
            model=model,
            content=content,
            response_id=response_id,
        )
