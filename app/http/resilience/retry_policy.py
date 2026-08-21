"""Retry delay policy: Retry-After, exponential backoff, optional jitter, attempt limit."""

from __future__ import annotations

import random
from dataclasses import dataclass

from app.http.resilience.classifier import ClassificationResult, HttpOutcome


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    """Decide whether to continue and how long to wait between attempts.

    Delay rules:
    - RATE_LIMIT with Retry-After → use that value (no jitter; header wins)
    - otherwise → ``initial_backoff * 2**(attempt-1)`` with optional full jitter

    ``jitter_ratio`` defaults to ``0`` so existing call sites keep deterministic
    exponential delays unless they opt in. ``1.0`` = classic full jitter
    ``uniform(0, base)``.
    """

    max_attempts: int
    initial_backoff_seconds: float = 1.0
    jitter_ratio: float = 0.0
    rng: random.Random | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "max_attempts", max(1, int(self.max_attempts)))
        object.__setattr__(self, "initial_backoff_seconds", max(0.0, float(self.initial_backoff_seconds)))
        object.__setattr__(self, "jitter_ratio", max(0.0, min(1.0, float(self.jitter_ratio))))

    def should_continue(self, attempt: int) -> bool:
        """True when another attempt remains after the current ``attempt`` (1-based)."""

        return int(attempt) < self.max_attempts

    def exponential_backoff_seconds(self, attempt: int) -> float:
        """Base delay before jitter for the given 1-based attempt index."""

        exp = max(0, int(attempt) - 1)
        return float(self.initial_backoff_seconds * (2**exp))

    def apply_jitter(self, base_seconds: float) -> float:
        if base_seconds <= 0 or self.jitter_ratio <= 0:
            return max(0.0, float(base_seconds))
        rng = self.rng if self.rng is not None else random
        # Full jitter scaled by ratio: mix deterministic base with uniform(0, base).
        jittered = float(rng.uniform(0.0, base_seconds))
        return max(0.0, base_seconds * (1.0 - self.jitter_ratio) + jittered * self.jitter_ratio)

    def delay_seconds(self, *, attempt: int, classification: ClassificationResult) -> float:
        """Seconds to sleep before the next attempt."""

        if (
            classification.outcome == HttpOutcome.RATE_LIMIT
            and classification.retry_after_seconds is not None
        ):
            return max(0.0, float(classification.retry_after_seconds))
        return self.apply_jitter(self.exponential_backoff_seconds(attempt))
