"""AI provider adapter interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from app.ai_providers.adapters.types import (
    CredentialProbeResult,
    HealthCheckResult,
    ProviderHttpRequest,
    ProviderSendResult,
)


class AiProviderAdapter(ABC):
    @property
    @abstractmethod
    def provider_type(self) -> str:
        """Normalized provider type enum value."""

    @abstractmethod
    def validate_credentials(
        self,
        provider_config: dict[str, Any],
        auth_json: dict[str, Any],
        *,
        timeout_seconds: float,
    ) -> CredentialProbeResult:
        raise NotImplementedError

    def health_check(
        self,
        provider_config: dict[str, Any],
        auth_json: dict[str, Any],
        *,
        timeout_seconds: float,
    ) -> HealthCheckResult:
        probe = self.validate_credentials(
            provider_config,
            auth_json,
            timeout_seconds=timeout_seconds,
        )
        return HealthCheckResult(
            ok=probe.ok,
            message=probe.message,
            latency_ms=probe.latency_ms,
            http_status=probe.http_status,
        )

    @abstractmethod
    def list_models(
        self,
        provider_config: dict[str, Any],
        auth_json: dict[str, Any],
        *,
        timeout_seconds: float,
    ) -> list[str]:
        raise NotImplementedError

    @abstractmethod
    def build_http_request(
        self,
        provider_request: dict[str, Any],
        provider_config: dict[str, Any],
        auth_json: dict[str, Any],
    ) -> ProviderHttpRequest:
        raise NotImplementedError

    @abstractmethod
    def send_request(
        self,
        request: ProviderHttpRequest,
        *,
        timeout_seconds: float,
    ) -> ProviderSendResult:
        raise NotImplementedError
