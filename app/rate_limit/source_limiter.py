"""Source-side rate limiting — protects upstream APIs from over-polling.

HTTP 429 / Retry-After remain the responsibility of the Unified HTTP Resilience
layer; this limiter only enforces Stream.rate_limit_json proactive caps.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any


class SourceRateLimiter:
    """Throttle outbound source fetches per stream using a token bucket.

    Config keys (Stream.rate_limit_json), matching master design §15.1:
      - max_requests: bucket capacity / tokens per window
      - per_seconds: refill interval for a full bucket

    Empty / invalid config → allow (no limit).
    Instance-local state only — no process-global mutable singleton.
    Must remain separate from DestinationRateLimiter (project policy).
    """

    def __init__(self, *, clock: Callable[[], float] | None = None) -> None:
        self._clock: Callable[[], float] = clock or time.monotonic
        # stream_id -> {tokens, last_refill, capacity, refill_per_second}
        self._buckets: dict[int, dict[str, float]] = {}

    def allow(self, stream_id: int, rate_limit_json: dict[str, Any] | None = None) -> bool:
        """Return True if a source fetch may proceed for this stream."""

        cfg = rate_limit_json or {}
        if not cfg:
            return True

        try:
            max_requests = int(cfg.get("max_requests", 0))
            per_seconds = float(cfg.get("per_seconds", 0) or 0)
        except (TypeError, ValueError):
            return True

        if max_requests <= 0 or per_seconds <= 0:
            return True

        capacity = float(max_requests)
        refill_per_second = capacity / per_seconds
        now = float(self._clock())
        sid = int(stream_id)

        bucket = self._buckets.get(sid)
        if bucket is None:
            # First allow consumes one token from a full bucket.
            self._buckets[sid] = {
                "tokens": capacity - 1.0,
                "last_refill": now,
                "capacity": capacity,
                "refill_per_second": refill_per_second,
            }
            return True

        # Apply latest config (operator may change rate_limit_json without restart).
        bucket["capacity"] = capacity
        bucket["refill_per_second"] = refill_per_second

        elapsed = max(0.0, now - float(bucket["last_refill"]))
        tokens = min(capacity, float(bucket["tokens"]) + elapsed * refill_per_second)
        bucket["last_refill"] = now

        if tokens < 1.0:
            bucket["tokens"] = tokens
            return False

        bucket["tokens"] = tokens - 1.0
        return True
