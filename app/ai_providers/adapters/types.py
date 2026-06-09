"""Shared types for AI provider adapters."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ProviderHttpRequest:
    method: str
    url: str
    headers: dict[str, str]
    json_body: dict[str, Any]
    timeout_seconds: float


@dataclass(frozen=True)
class ProviderSendResult:
    success: bool
    status_code: int
    latency_ms: int
    provider_response_id: str | None
    normalized_response: dict[str, Any]
    error_code: str | None = None
    error_message: str | None = None


@dataclass(frozen=True)
class CredentialProbeResult:
    ok: bool
    latency_ms: float
    message: str
    http_status: int | None = None


@dataclass(frozen=True)
class HealthCheckResult:
    ok: bool
    message: str
    latency_ms: float | None = None
    http_status: int | None = None
