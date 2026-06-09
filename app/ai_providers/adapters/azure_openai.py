"""Azure OpenAI Chat Completions provider adapter."""

from __future__ import annotations

import time
from typing import Any

import httpx

from app.ai_providers.adapters.base import AiProviderAdapter
from app.ai_providers.adapters.http_common import build_send_result, execute_provider_http, raise_on_http_error
from app.ai_providers.adapters.types import CredentialProbeResult, ProviderHttpRequest, ProviderSendResult
from app.http.outbound_httpx_timeout import outbound_httpx_timeout


def _deployment_url(endpoint_url: str, deployment_name: str, api_version: str) -> str:
    base = str(endpoint_url or "").strip().rstrip("/")
    return f"{base}/openai/deployments/{deployment_name}/chat/completions?api-version={api_version}"


def _resolve_deployment(provider_request: dict[str, Any], provider_config: dict[str, Any]) -> str:
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
    raise ValueError("provider_request.model or default_model is required for AZURE_OPENAI")


class AzureOpenAiProviderAdapter(AiProviderAdapter):
    @property
    def provider_type(self) -> str:
        return "AZURE_OPENAI"

    def validate_credentials(
        self,
        provider_config: dict[str, Any],
        auth_json: dict[str, Any],
        *,
        timeout_seconds: float,
    ) -> CredentialProbeResult:
        started = time.perf_counter()
        api_key = str((auth_json or {}).get("api_key") or "").strip()
        if not api_key:
            return CredentialProbeResult(ok=False, latency_ms=0, message="api_key is required")
        api_version = str((auth_json or {}).get("api_version") or provider_config.get("api_version") or "2024-02-15-preview")
        deployment = _resolve_deployment({"model": provider_config.get("default_model")}, provider_config)
        url = _deployment_url(str(provider_config.get("endpoint_url") or ""), deployment, api_version)
        body = {
            "messages": [{"role": "user", "content": "ping"}],
            "max_tokens": 1,
            "stream": False,
        }
        headers = {"api-key": api_key, "Content-Type": "application/json"}
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
        deployment = str(provider_config.get("default_model") or "").strip()
        return [deployment] if deployment else []

    def build_http_request(
        self,
        provider_request: dict[str, Any],
        provider_config: dict[str, Any],
        auth_json: dict[str, Any],
    ) -> ProviderHttpRequest:
        api_key = str((auth_json or {}).get("api_key") or "").strip()
        if not api_key:
            raise ValueError("AZURE_OPENAI provider requires auth_json.api_key")
        api_version = str((auth_json or {}).get("api_version") or provider_config.get("api_version") or "2024-02-15-preview")
        deployment = _resolve_deployment(provider_request, provider_config)
        body = dict(provider_request or {})
        body.pop("model", None)
        body["stream"] = False
        timeout = float(provider_config.get("timeout_seconds") or 120)
        return ProviderHttpRequest(
            method="POST",
            url=_deployment_url(str(provider_config.get("endpoint_url") or ""), deployment, api_version),
            headers={"api-key": api_key, "Content-Type": "application/json"},
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
        raise_on_http_error(response, provider_label="AZURE_OPENAI")
        payload = response.json() if response.content else {}
        content = ""
        choices = payload.get("choices") if isinstance(payload, dict) else None
        if isinstance(choices, list) and choices:
            message = choices[0].get("message") if isinstance(choices[0], dict) else None
            if isinstance(message, dict):
                content = str(message.get("content") or "")
        model = str(payload.get("model") or "") if isinstance(payload, dict) else ""
        return build_send_result(
            response=response,
            latency_ms=latency_ms,
            provider_label="AZURE_OPENAI",
            model=model,
            content=content,
        )
