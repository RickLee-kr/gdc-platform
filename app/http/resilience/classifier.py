"""Classify HTTP responses / transport exceptions into shared outcomes."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

import httpx


class HttpOutcome(str, Enum):
    """Shared Source/Destination HTTP failure classification."""

    SUCCESS = "success"
    RETRY = "retry"
    RATE_LIMIT = "rate_limit"
    FATAL = "fatal"


@dataclass(frozen=True, slots=True)
class ClassificationResult:
    """Result of classifying one HTTP response or transport exception."""

    outcome: HttpOutcome
    status_code: int | None = None
    retry_after_seconds: float | None = None
    reason: str = ""


def parse_retry_after_header(value: str | None) -> float | None:
    """Parse ``Retry-After`` as delay-seconds.

    HTTP-date forms are ignored (same as historic Source float-only path): callers
    fall back to exponential backoff. Minimal helper for future RateLimiter reuse.
    """

    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        seconds = float(raw)
    except ValueError:
        return None
    if seconds < 0:
        return None
    return seconds


class ResponseClassifier:
    """Map HTTP response / exception → SUCCESS | RETRY | RATE_LIMIT | FATAL.

    Retryable status set (minimum contract):
    - connection / timeout transport errors → RETRY
    - 408 → RETRY
    - 429 → RATE_LIMIT (Retry-After when present)
    - 5xx → RETRY
    - other 4xx → FATAL
    - 2xx → SUCCESS
    """

    def classify_response(self, response: httpx.Response) -> ClassificationResult:
        status = int(response.status_code)
        if 200 <= status < 300:
            return ClassificationResult(outcome=HttpOutcome.SUCCESS, status_code=status, reason="2xx")
        if status == 429:
            retry_after = parse_retry_after_header(response.headers.get("Retry-After"))
            return ClassificationResult(
                outcome=HttpOutcome.RATE_LIMIT,
                status_code=status,
                retry_after_seconds=retry_after,
                reason="429",
            )
        if status == 408 or 500 <= status < 600:
            return ClassificationResult(
                outcome=HttpOutcome.RETRY,
                status_code=status,
                reason="408" if status == 408 else "5xx",
            )
        if 400 <= status < 500:
            return ClassificationResult(outcome=HttpOutcome.FATAL, status_code=status, reason="4xx")
        # 1xx / 3xx are not success for our outbound callers (no follow on source;
        # webhook uses raise_for_status historically for non-2xx).
        return ClassificationResult(outcome=HttpOutcome.FATAL, status_code=status, reason="non_2xx")

    def classify_exception(self, exc: BaseException) -> ClassificationResult:
        if isinstance(exc, httpx.HTTPStatusError) and exc.response is not None:
            return self.classify_response(exc.response)
        if isinstance(exc, (httpx.TimeoutException, TimeoutError)):
            return ClassificationResult(outcome=HttpOutcome.RETRY, reason="timeout")
        if isinstance(exc, (httpx.ConnectError, ConnectionError, OSError)):
            return ClassificationResult(outcome=HttpOutcome.RETRY, reason="connection")
        if isinstance(exc, httpx.HTTPError):
            return ClassificationResult(outcome=HttpOutcome.RETRY, reason="http_transport")
        return ClassificationResult(outcome=HttpOutcome.FATAL, reason="unknown")

    def is_retryable(self, result: ClassificationResult) -> bool:
        return result.outcome in {HttpOutcome.RETRY, HttpOutcome.RATE_LIMIT}


# Alias kept for RateLimiter / callers that only need header parsing.
def retry_after_from_headers(headers: Any) -> float | None:
    """Extract Retry-After seconds from a headers mapping (httpx or dict-like)."""

    if headers is None:
        return None
    try:
        value = headers.get("Retry-After")  # type: ignore[union-attr]
    except Exception:
        return None
    return parse_retry_after_header(value if value is None else str(value))
