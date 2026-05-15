"""Structured wall-clock timing for selected read-only list / dashboard GET APIs."""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)

_WARN_MS = 1000.0
_CRIT_MS = 3000.0


def _metric_for_path(path: str) -> tuple[str, str] | None:
    """Return (log_field_name, short_label) or None when this path is not metered."""

    p = path.rstrip("/")
    if p.endswith("/runtime/dashboard/summary"):
        return ("runtime_summary_ms", "runtime_dashboard_summary")
    if p.endswith("/streams"):
        return ("stream_list_ms", "streams_list")
    if p.endswith("/connectors"):
        return ("connector_list_ms", "connectors_list")
    return None


class ReadApiTimingMiddleware(BaseHTTPMiddleware):
    """Emit structured timing for dashboard / stream / connector list GETs; warn on slow reads."""

    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        if request.method != "GET":
            return await call_next(request)

        metric = _metric_for_path(request.url.path)
        if metric is None:
            return await call_next(request)

        field, label = metric
        t0 = time.perf_counter()
        try:
            return await call_next(request)
        finally:
            elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 3)
            base: dict[str, object] = {
                "stage": "read_api_timing",
                "read_handler": label,
                "path": request.url.path,
                "elapsed_ms": elapsed_ms,
                field: elapsed_ms,
            }
            if elapsed_ms >= _CRIT_MS:
                base["slow_threshold"] = "critical"
                base["slow_threshold_ms"] = _CRIT_MS
                logger.error("%s", base)
            elif elapsed_ms >= _WARN_MS:
                base["slow_threshold"] = "warning"
                base["slow_threshold_ms"] = _WARN_MS
                logger.warning("%s", base)
            else:
                logger.debug("%s", base)
