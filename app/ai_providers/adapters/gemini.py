"""Google Gemini generateContent provider adapter."""

from __future__ import annotations

import time
from typing import Any

import httpx

from app.ai_providers.adapters.base import AiProviderAdapter
from app.ai_providers.adapters.http_common import build_send_result, execute_provider_http, raise_on_http_error
from app.ai_providers.adapters.types import CredentialProbeResult, ProviderHttpRequest, ProviderSendResult
from app.http.outbound_httpx_timeout import outbound_httpx_timeout

DEFAULT_MODEL = "gemini-1.5-flash"


def _resolve_model(provider_request: dict[str, Any], provider_config: dict[str, Any]) -> str:
    override = provider_config.get("model_override")
    if override:
        return str(override).strip()
    model = str((provider_request or {}).get("model") or "").strip()
    if model:
        return model
    default_model = str(provider_config.get("default_model") or "").strip()
    return default_model or DEFAULT_MODEL


def _generate_content_url(endpoint_url: str, model: str) -> str:
    base = str(endpoint_url or "").strip().rstrip("/")
    if ":generateContent" in base:
        return base
    if "/v1beta/models/" in base:
        return base if base.endswith(":generateContent") else f"{base}:generateContent"
    return f"{base}/v1beta/models/{model}:generateContent"


def _to_gemini_body(provider_request: dict[str, Any]) -> dict[str, Any]:
    messages = provider_request.get("messages") if isinstance(provider_request.get("messages"), list) else []
    contents: list[dict[str, Any]] = []
    for item in messages:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "user")
        gemini_role = "model" if role == "assistant" else "user"
        contents.append(
            {
                "role": gemini_role,
                "parts": [{"text": str(item.get("content") or "")}],
            }
        )
    body: dict[str, Any] = {"contents": contents or [{"role": "user", "parts": [{"text": "ping"}]}]}
    generation_config: dict[str, Any] = {}
    if provider_request.get("temperature") is not None:
        generation_config["temperature"] = float(provider_request.get("temperature"))
    if provider_request.get("max_tokens") is not None:
        generation_config["maxOutputTokens"] = int(provider_request.get("max_tokens"))
    if generation_config:
        body["generationConfig"] = generation_config
    return body


class GeminiProviderAdapter(AiProviderAdapter):
    @property
    def provider_type(self) -> str:
        return "GEMINI"

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
        model = _resolve_model({}, provider_config)
        url = _generate_content_url(str(provider_config.get("endpoint_url") or ""), model)
        headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}
        try:
            httpx_timeout = outbound_httpx_timeout(timeout_seconds)
            with httpx.Client(timeout=httpx_timeout) as client:
                response = client.post(url, headers=headers, json=_to_gemini_body({}))
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
        api_key = str((auth_json or {}).get("api_key") or "").strip()
        if not api_key:
            raise ValueError("GEMINI provider requires auth_json.api_key")
        model = _resolve_model(provider_request, provider_config)
        timeout = float(provider_config.get("timeout_seconds") or 120)
        return ProviderHttpRequest(
            method="POST",
            url=_generate_content_url(str(provider_config.get("endpoint_url") or ""), model),
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            json_body=_to_gemini_body(provider_request),
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
        raise_on_http_error(response, provider_label="GEMINI")
        payload = response.json() if response.content else {}
        content = ""
        if isinstance(payload, dict):
            candidates = payload.get("candidates")
            if isinstance(candidates, list) and candidates:
                parts = candidates[0].get("content", {}).get("parts") if isinstance(candidates[0], dict) else None
                if isinstance(parts, list) and parts and isinstance(parts[0], dict):
                    content = str(parts[0].get("text") or "")
        model = _resolve_model({}, {"default_model": request.json_body.get("model")})
        return build_send_result(
            response=response,
            latency_ms=latency_ms,
            provider_label="GEMINI",
            model=model,
            content=content,
        )
