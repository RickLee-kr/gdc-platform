"""In-process TTL cache for GET /api/v1/governance/summary (no Redis / no new tables)."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from threading import Lock

from sqlalchemy.orm import Session

from app.governance.schemas import GovernanceSummaryResponse
from app.governance.service import build_governance_summary

logger = logging.getLogger(__name__)

_TTL_SEC = 30.0
_CACHE_KEY = "governance_summary"


@dataclass
class _CacheEntry:
    value: GovernanceSummaryResponse
    mono_ts: float


_lock = Lock()
_cache: dict[str, _CacheEntry] = {}


def get_governance_summary_cached(db: Session) -> GovernanceSummaryResponse:
    """Return cached summary on hit; compute once on miss within TTL window."""

    now = time.monotonic()
    with _lock:
        entry = _cache.get(_CACHE_KEY)
        if entry is not None and (now - entry.mono_ts) < _TTL_SEC:
            logger.debug(
                "%s",
                {"stage": "governance_summary_cache", "cache_hit": True, "cache_key": _CACHE_KEY},
            )
            return entry.value

    value = build_governance_summary(db)
    with _lock:
        _cache[_CACHE_KEY] = _CacheEntry(value=value, mono_ts=time.monotonic())
        logger.debug(
            "%s",
            {"stage": "governance_summary_cache", "cache_miss": True, "cache_key": _CACHE_KEY},
        )
    return value


def clear_governance_summary_cache() -> None:
    """Drop cached entries (tests / admin hooks)."""

    with _lock:
        _cache.clear()
