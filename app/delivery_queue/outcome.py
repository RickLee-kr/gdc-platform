"""Map Destination send failures → durable queue outcomes using HTTP Resilience.

Reuses ``ResponseClassifier`` / ``RetryPolicy`` — does not invent a parallel
retry classification engine (audit design §Q11).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from app.http.resilience import (
    ClassificationResult,
    HttpOutcome,
    ResponseClassifier,
    RetryPolicy,
)
from app.runtime.errors import DestinationSendError

_CLASSIFIER = ResponseClassifier()


@dataclass(frozen=True, slots=True)
class QueueSendClassification:
    """Durable-queue decision after Destination I/O completes (or fails)."""

    outcome: HttpOutcome
    status_code: int | None
    retry_after_seconds: float | None
    reason: str
    retryable: bool


def classify_destination_send_error(error: BaseException) -> QueueSendClassification:
    """Classify a raised send error with the shared HTTP resilience rules."""

    if isinstance(error, DestinationSendError):
        status = error.http_status
        retry_after = error.retry_after_seconds
        if status is not None:
            # Reconstruct classification from status (+ Retry-After when present).
            if 200 <= int(status) < 300:
                result = ClassificationResult(
                    outcome=HttpOutcome.SUCCESS, status_code=int(status), reason="2xx"
                )
            elif int(status) == 429:
                result = ClassificationResult(
                    outcome=HttpOutcome.RATE_LIMIT,
                    status_code=429,
                    retry_after_seconds=retry_after,
                    reason="429",
                )
            elif int(status) == 408 or 500 <= int(status) < 600:
                result = ClassificationResult(
                    outcome=HttpOutcome.RETRY,
                    status_code=int(status),
                    reason="408" if int(status) == 408 else "5xx",
                )
            elif 400 <= int(status) < 500:
                result = ClassificationResult(
                    outcome=HttpOutcome.FATAL, status_code=int(status), reason="4xx"
                )
            else:
                result = ClassificationResult(
                    outcome=HttpOutcome.FATAL, status_code=int(status), reason="non_2xx"
                )
        elif error.__cause__ is not None:
            result = _CLASSIFIER.classify_exception(error.__cause__)
            if retry_after is not None and result.outcome == HttpOutcome.RATE_LIMIT:
                result = ClassificationResult(
                    outcome=result.outcome,
                    status_code=result.status_code,
                    retry_after_seconds=retry_after,
                    reason=result.reason,
                )
        else:
            # DestinationSendError without status — treat as transport-style retryable
            # (matches failover eligibility treating bare DestinationSendError as eligible).
            result = ClassificationResult(outcome=HttpOutcome.RETRY, reason="destination_send")
    else:
        result = _CLASSIFIER.classify_exception(error)

    return QueueSendClassification(
        outcome=result.outcome,
        status_code=result.status_code,
        retry_after_seconds=result.retry_after_seconds,
        reason=result.reason,
        retryable=_CLASSIFIER.is_retryable(result),
    )


def compute_retry_available_at(
    *,
    attempt: int,
    classification: QueueSendClassification,
    initial_backoff_seconds: float,
    now: datetime | None = None,
) -> datetime:
    """Compute ``available_at`` consistent with HTTP Resilience delay semantics."""

    ts = now or datetime.now(timezone.utc)
    # max_attempts only needed for delay math; value must exceed ``attempt``.
    policy = RetryPolicy(
        max_attempts=max(int(attempt) + 1, 2),
        initial_backoff_seconds=float(initial_backoff_seconds),
    )
    result = ClassificationResult(
        outcome=classification.outcome,
        status_code=classification.status_code,
        retry_after_seconds=classification.retry_after_seconds,
        reason=classification.reason,
    )
    delay = max(0.0, float(policy.delay_seconds(attempt=int(attempt), classification=result)))
    return ts + timedelta(seconds=delay)


def max_durable_attempts(destination_config: dict[str, Any] | None) -> int:
    """Durable claim budget.

    ``retry_count`` mirrors webhook in-request retries; durable path keeps at least
    two claim slots so a retryable failure after the first claim can enter
    ``RETRY_WAIT`` (Phase 3 reclaim) instead of immediate ``EXHAUSTED``.
    """

    cfg = destination_config if isinstance(destination_config, dict) else {}
    retries = int(cfg.get("retry_count", 2) or 0)
    return max(2, retries + 1)


def delivery_idempotency_header_value(*, batch_id: str, item_id: int) -> str:
    """Stable delivery identifier for optional webhook idempotency headers.

    Destinations that ignore unknown headers remain compatible. This does **not**
    provide exactly-once when the sink lacks idempotency support (crash window B).
    """

    return f"{str(batch_id).strip()}:{int(item_id)}"


def inject_delivery_idempotency_header(
    destination_config: dict[str, Any],
    *,
    batch_id: str,
    item_id: int,
) -> dict[str, Any]:
    """Copy config and set ``X-Data-Relay-Delivery-Id`` when not already present."""

    cfg = dict(destination_config or {})
    headers = dict(cfg.get("headers") or {})
    key = "X-Data-Relay-Delivery-Id"
    # Preserve operator-configured idempotency headers.
    if not any(str(k).lower() == key.lower() for k in headers):
        headers[key] = delivery_idempotency_header_value(batch_id=batch_id, item_id=item_id)
    cfg["headers"] = headers
    return cfg
