"""Persistent outbound connection pools for delivery and provider HTTP."""

from __future__ import annotations

import threading

import httpx


class HttpxClientPool:
    """Thread-safe pool of persistent httpx.Client instances."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._clients: dict[str, httpx.Client] = {}

    def get(self, pool_key: str, *, timeout: httpx.Timeout) -> httpx.Client:
        with self._lock:
            client = self._clients.get(pool_key)
            if (
                client is None
                or getattr(client, "is_closed", False)
                or not isinstance(client, httpx.Client)
            ):
                client = httpx.Client(timeout=timeout)
                self._clients[pool_key] = client
            return client

    def invalidate(self, pool_key: str) -> None:
        with self._lock:
            client = self._clients.pop(pool_key, None)
        if client is not None and not getattr(client, "is_closed", False):
            client.close()


_httpx_pool = HttpxClientPool()


def get_httpx_client(*, pool_key: str, timeout: httpx.Timeout) -> httpx.Client:
    return _httpx_pool.get(pool_key, timeout=timeout)


def invalidate_httpx_client(pool_key: str) -> None:
    _httpx_pool.invalidate(pool_key)
