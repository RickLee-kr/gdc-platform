"""Destination-side rate limiting — EPS, batching, burst."""

from __future__ import annotations

import time
from typing import Any


class DestinationRateLimiter:
    """Throttle deliveries per route using ``max_events`` / ``per_seconds`` windows.

    Must remain separate from SourceRateLimiter (project policy).
    Call ``allow(route_id, rate_limit_json)`` with the effective merged JSON from
    Route / Destination (see StreamRunner fan-out).
    """

    def __init__(self) -> None:
        self._windows: dict[int, dict[str, Any]] = {}

    def allow(self, route_id: int, rate_limit_json: dict[str, Any] | None = None) -> bool:
        """Return True if delivery may proceed for this route."""

        cfg = rate_limit_json or {}
        if not cfg:
            return True

        max_events = int(cfg.get("max_events", 0))
        per_seconds = float(cfg.get("per_seconds", 1))
        if max_events <= 0 or per_seconds <= 0:
            return True

        now = time.monotonic()
        st = self._windows.get(route_id)
        if st is None:
            self._windows[route_id] = {"window_start": now, "sent": 1}
            return True

        window_start = float(st["window_start"])
        sent = int(st["sent"])
        elapsed = now - window_start
        if elapsed >= per_seconds:
            st["window_start"] = now
            st["sent"] = 1
            return True

        if sent >= max_events:
            return False

        st["sent"] = sent + 1
        return True
