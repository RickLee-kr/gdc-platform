"""Deterministic mock AI provider — no outbound network."""

from __future__ import annotations

from typing import Any

from app.ai_providers.adapters.base import AiProviderAdapter
from app.ai_providers.adapters.types import (
    CredentialProbeResult,
    ProviderHttpRequest,
    ProviderSendResult,
)


class MockProviderAdapter(AiProviderAdapter):
    @property
    def provider_type(self) -> str:
        return "MOCK"

    def validate_credentials(
        self,
        provider_config: dict[str, Any],
        auth_json: dict[str, Any],
        *,
        timeout_seconds: float,
    ) -> CredentialProbeResult:
        return CredentialProbeResult(ok=True, latency_ms=0.0, message="Mock provider ready")

    def list_models(
        self,
        provider_config: dict[str, Any],
        auth_json: dict[str, Any],
        *,
        timeout_seconds: float,
    ) -> list[str]:
        return ["mock-model"]

    def build_http_request(
        self,
        provider_request: dict[str, Any],
        provider_config: dict[str, Any],
        auth_json: dict[str, Any],
    ) -> ProviderHttpRequest:
        return ProviderHttpRequest(
            method="POST",
            url=str(provider_config.get("endpoint_url") or "mock://local"),
            headers={},
            json_body=dict(provider_request or {}),
            timeout_seconds=float(provider_config.get("timeout_seconds") or 120),
        )

    def send_request(
        self,
        request: ProviderHttpRequest,
        *,
        timeout_seconds: float,
    ) -> ProviderSendResult:
        model = str((request.json_body or {}).get("model") or "mock-model")
        return ProviderSendResult(
            success=True,
            status_code=200,
            latency_ms=0,
            provider_response_id="mock-response",
            normalized_response={
                "id": "mock-response",
                "provider": "MOCK",
                "model": model,
                "content": "Mock response",
            },
        )
