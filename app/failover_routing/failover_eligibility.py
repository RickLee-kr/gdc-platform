"""Determine whether a destination send failure may trigger Active/Standby failover."""

from __future__ import annotations

import httpx

from app.runtime.errors import DestinationSendError


def _http_status_from_error(error: Exception) -> int | None:
    status = getattr(error, "http_status", None)
    if isinstance(status, int):
        return status
    cause = getattr(error, "__cause__", None)
    if isinstance(cause, httpx.HTTPStatusError) and cause.response is not None:
        return int(cause.response.status_code)
    if isinstance(error, httpx.HTTPStatusError) and error.response is not None:
        return int(error.response.status_code)
    return None


def is_failover_eligible_error(error: Exception) -> bool:
    """Eligible: TCP/UDP/syslog connect, webhook timeout, webhook 5xx. Not eligible: HTTP 429."""

    status = _http_status_from_error(error)
    if status is not None:
        if status == 429:
            return False
        return 500 <= status < 600
    if isinstance(error, DestinationSendError):
        return True
    if isinstance(error, (OSError, ConnectionError, TimeoutError)):
        return True
    if isinstance(error, httpx.TimeoutException):
        return True
    return False
