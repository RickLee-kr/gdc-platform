"""Eligibility for recording or replaying destination delivery failures."""

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


def is_replay_record_eligible(*, error: Exception | None = None, rate_limited: bool = False) -> bool:
    """Return False for rate-limited skips, HTTP 429, policy blocks, and preview-only paths."""

    from app.ai_policy.errors import AiPolicyEnforcementError

    if rate_limited:
        return False
    if isinstance(error, AiPolicyEnforcementError):
        return False
    if error is None:
        return True
    status = _http_status_from_error(error)
    if status == 429:
        return False
    return True
