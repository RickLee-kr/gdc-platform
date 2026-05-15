"""Explicit httpx.Timeout presets for outbound HTTP (connect / read / write / pool)."""

from __future__ import annotations

import httpx


def outbound_httpx_timeout(
    read_seconds: float,
    *,
    connect_cap: float = 15.0,
    connect_floor: float = 2.0,
    pool_seconds: float = 5.0,
) -> httpx.Timeout:
    """Map a logical read budget to bounded connect + read timeouts (no single float)."""

    read = max(1.0, float(read_seconds))
    connect = min(connect_cap, max(connect_floor, read * 0.25))
    return httpx.Timeout(connect=connect, read=read, write=read, pool=pool_seconds)
