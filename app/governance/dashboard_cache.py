"""In-process TTL cache for GET /api/v1/governance/dashboard/summary."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from threading import Lock

from sqlalchemy.orm import Session

from app.governance.dashboard_summary_service import _build_governance_dashboard_summary
from app.governance.schemas import GovernanceDashboardSummaryResponse

logger = logging.getLogger(__name__)

_TTL_SEC = 30.0
_CACHE_KEY = "governance_dashboard_summary"


@dataclass
class _CacheEntry:
    value: GovernanceDashboardSummaryResponse
    mono_ts: float


_lock = Lock()
_cache: dict[str, _CacheEntry] = {}


def get_governance_dashboard_summary_cached(db: Session) -> GovernanceDashboardSummaryResponse:
    """Return cached executive dashboard summary on hit; compute once on miss within TTL."""

    now = time.monotonic()
    with _lock:
        entry = _cache.get(_CACHE_KEY)
        if entry is not None and (now - entry.mono_ts) < _TTL_SEC:
            logger.debug(
                "%s",
                {
                    "stage": "governance_dashboard_summary_cache",
                    "cache_hit": True,
                    "cache_key": _CACHE_KEY,
                },
            )
            return entry.value

    value = _build_governance_dashboard_summary(db)
    with _lock:
        _cache[_CACHE_KEY] = _CacheEntry(value=value, mono_ts=time.monotonic())
        logger.debug(
            "%s",
            {
                "stage": "governance_dashboard_summary_cache",
                "cache_miss": True,
                "cache_key": _CACHE_KEY,
            },
        )
    return value


def clear_governance_dashboard_summary_cache() -> None:
    """Drop cached entries (tests / admin hooks)."""

    with _lock:
        _cache.clear()
