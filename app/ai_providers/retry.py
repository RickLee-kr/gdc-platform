"""Retry policy for AI provider outbound requests."""

from __future__ import annotations

import httpx

from app.runtime.errors import DestinationSendError


def http_status_from_error(error: Exception) -> int | None:
    status = getattr(error, "http_status", None)
    if isinstance(status, int):
        return status
    cause = getattr(error, "__cause__", None)
    if isinstance(cause, httpx.HTTPStatusError) and cause.response is not None:
        return int(cause.response.status_code)
    if isinstance(error, httpx.HTTPStatusError) and error.response is not None:
        return int(error.response.status_code)
    return None


def should_retry_ai_provider_error(error: Exception) -> bool:
    """M21.2: retry 5xx, 429, timeout/connect; no retry on other 4xx."""

    if isinstance(error, (httpx.TimeoutException, TimeoutError, ConnectionError, OSError)):
        return True
    if isinstance(error, httpx.HTTPError) and not isinstance(error, httpx.HTTPStatusError):
        return True
    status = http_status_from_error(error)
    if status is None:
        return isinstance(error, DestinationSendError)
    if status == 429:
        return True
    if 500 <= status < 600:
        return True
    if 400 <= status < 500:
        return False
    return False
