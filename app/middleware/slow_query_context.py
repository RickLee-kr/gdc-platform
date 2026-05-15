"""Bind HTTP request path into contextvars for slow SQL logging."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.observability.slow_query import http_sql_cache_cv, http_sql_endpoint_cv


class SlowQueryRequestContextMiddleware(BaseHTTPMiddleware):
    """Expose ``METHOD path`` and default cache marker to SQLAlchemy slow-query listeners."""

    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        ep = f"{request.method} {request.url.path}"
        t_ep = http_sql_endpoint_cv.set(ep)
        t_cache = http_sql_cache_cv.set("n_a")
        try:
            return await call_next(request)
        finally:
            http_sql_endpoint_cv.reset(t_ep)
            http_sql_cache_cv.reset(t_cache)
