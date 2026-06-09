"""Shared HTTP helpers for AI provider adapters."""

from __future__ import annotations

import time
from typing import Any

import httpx

from app.ai_providers.adapters.types import ProviderSendResult
from app.delivery.connection_pool import get_httpx_client, invalidate_httpx_client
from app.http.outbound_httpx_timeout import outbound_httpx_timeout
from app.runtime.errors import DestinationSendError


def execute_provider_http(
    request_method: str,
    url: str,
    *,
    headers: dict[str, str],
    json_body: dict[str, Any] | None,
    timeout_seconds: float,
) -> tuple[httpx.Response, int]:
    started = time.perf_counter()
    httpx_timeout = outbound_httpx_timeout(timeout_seconds)
    pool_key = f"ai-provider:{request_method}:{url}"
    client = get_httpx_client(pool_key=pool_key, timeout=httpx_timeout)
    try:
        response = client.request(request_method, url, headers=headers, json=json_body)
    except httpx.TimeoutException as exc:
        invalidate_httpx_client(pool_key)
        raise DestinationSendError(f"Provider request timed out: {exc}") from exc
    except httpx.HTTPError as exc:
        invalidate_httpx_client(pool_key)
        raise DestinationSendError(f"Provider request failed: {exc}") from exc
    latency_ms = int(round((time.perf_counter() - started) * 1000.0))
    return response, latency_ms


def raise_on_http_error(response: httpx.Response, *, provider_label: str) -> None:
    if response.status_code >= 400:
        raise DestinationSendError(
            f"{provider_label} HTTP {response.status_code}",
            http_status=int(response.status_code),
        )


def build_send_result(
    *,
    response: httpx.Response,
    latency_ms: int,
    provider_label: str,
    model: str,
    content: str,
    response_id: str | None = None,
) -> ProviderSendResult:
    payload = response.json() if response.content else {}
    if response_id is None and isinstance(payload, dict):
        response_id = str(payload.get("id") or "") or None
    normalized = {
        "id": response_id or f"{provider_label.lower()}-response",
        "provider": provider_label,
        "model": model,
        "content": content,
        "raw": payload if isinstance(payload, dict) else {},
    }
    return ProviderSendResult(
        success=True,
        status_code=int(response.status_code),
        latency_ms=latency_ms,
        provider_response_id=response_id,
        normalized_response=normalized,
    )
