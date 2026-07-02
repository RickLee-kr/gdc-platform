"""Process-local TTL cache for GET /runtime/observability/summary."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from threading import Lock

from sqlalchemy.orm import Session

from app.runtime.observability_summary import _build_observability_summary
from app.runtime.schemas import ObservabilitySummaryResponse

logger = logging.getLogger(__name__)

_TTL_SEC = 8.0


@dataclass
class _CacheEntry:
    value: ObservabilitySummaryResponse
    mono_ts: float


_lock = Lock()
_cache: dict[str, _CacheEntry] = {}


def _cache_key(window: str, snapshot_id: str | None) -> str:
    snap = (snapshot_id or "latest").strip() or "latest"
    return f"window={window};snapshot={snap}"


def get_observability_summary_cached(
    db: Session,
    *,
    window: str = "24h",
    snapshot_id: str | None = None,
) -> ObservabilitySummaryResponse:
    key = _cache_key(window, snapshot_id)
    now = time.monotonic()
    with _lock:
        entry = _cache.get(key)
        if entry is not None and (now - entry.mono_ts) < _TTL_SEC:
            return entry.value

    value = _build_observability_summary(db, window=window, snapshot_id=snapshot_id)
    with _lock:
        _cache[key] = _CacheEntry(value=value, mono_ts=time.monotonic())
    return value


def clear_observability_summary_cache() -> None:
    with _lock:
        _cache.clear()
