"""Process-local TTL cache for lightweight Connectors catalog read endpoints."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from threading import Lock
from typing import Generic, TypeVar

from sqlalchemy.orm import Session

from app.config import settings
from app.connectors.operations_schemas import ConnectorOperationsSummaryResponse
from app.connectors.schemas import ConnectorRead

logger = logging.getLogger(__name__)

_LIST_CACHE_KEY = "connectors_list"
_OPS_TTL_SEC = 20.0
_LIST_FRESH_TTL_SEC = max(1.0, float(settings.GDC_CONNECTORS_LIST_CACHE_TTL_SEC))

T = TypeVar("T")


@dataclass
class _CacheEntry(Generic[T]):
    value: T
    mono_ts: float


@dataclass
class ConnectorsListCacheMetrics:
    cache_hit: bool = False
    cache_miss: bool = False
    stale_fallback: bool = False
    pool_wait_ms: float | None = None
    db_load_ms: float | None = None


_lock = Lock()
_list_fresh: _CacheEntry[list[ConnectorRead]] | None = None
_list_stale: _CacheEntry[list[ConnectorRead]] | None = None
_ops_cache: dict[str, _CacheEntry[ConnectorOperationsSummaryResponse]] = {}


def _store_connectors_list_success(value: list[ConnectorRead]) -> None:
    now = time.monotonic()
    entry = _CacheEntry(value=value, mono_ts=now)
    with _lock:
        global _list_fresh, _list_stale
        _list_fresh = entry
        _list_stale = entry


def _peek_connectors_list_fresh() -> list[ConnectorRead] | None:
    now = time.monotonic()
    with _lock:
        if _list_fresh is not None and (now - _list_fresh.mono_ts) < _LIST_FRESH_TTL_SEC:
            return _list_fresh.value
    return None


def _peek_connectors_list_stale() -> list[ConnectorRead] | None:
    with _lock:
        if _list_stale is not None:
            return _list_stale.value
    return None


def resolve_connectors_list_catalog(
    db_loader: Callable[[], tuple[list[ConnectorRead], float, float]],
) -> tuple[list[ConnectorRead], ConnectorsListCacheMetrics]:
    """Cache-first connectors list: fresh hit → catalog DB → stale last-success fallback."""

    fresh = _peek_connectors_list_fresh()
    if fresh is not None:
        logger.debug("%s", {"stage": "connectors_list_cache", "cache_hit": True, "fresh": True})
        return fresh, ConnectorsListCacheMetrics(cache_hit=True)

    metrics = ConnectorsListCacheMetrics(cache_miss=True)
    try:
        value, pool_wait_ms, db_load_ms = db_loader()
        metrics.pool_wait_ms = pool_wait_ms
        metrics.db_load_ms = db_load_ms
        _store_connectors_list_success(value)
        logger.debug(
            "%s",
            {
                "stage": "connectors_list_cache",
                "cache_miss": True,
                "count": len(value),
                "db_load_ms": db_load_ms,
            },
        )
        return value, metrics
    except Exception:
        stale = _peek_connectors_list_stale()
        if stale is not None:
            logger.warning(
                "%s",
                {
                    "stage": "connectors_list_cache",
                    "cache_miss": True,
                    "stale_fallback": True,
                    "count": len(stale),
                },
            )
            return stale, ConnectorsListCacheMetrics(cache_miss=True, stale_fallback=True)
        raise


def get_connectors_list_cached(db: Session | None, loader: Callable[[Session], list[ConnectorRead]]) -> list[ConnectorRead]:
    """Return cached connector rows when fresh; otherwise load once and cache (test/helper path)."""

    fresh = _peek_connectors_list_fresh()
    if fresh is not None:
        return fresh

    if db is None:
        raise RuntimeError("connectors list cache miss requires a database session")

    value = loader(db)
    _store_connectors_list_success(value)
    return value


def peek_connectors_list_cache() -> list[ConnectorRead] | None:
    """Return fresh cached connector rows without touching the database."""

    return _peek_connectors_list_fresh()


def peek_connectors_list_stale_cache() -> list[ConnectorRead] | None:
    """Return last successful connector rows regardless of TTL."""

    return _peek_connectors_list_stale()


def get_connectors_operations_summary_cached(
    db: Session,
    *,
    window: str,
    loader: Callable[[Session], ConnectorOperationsSummaryResponse],
) -> ConnectorOperationsSummaryResponse:
    """Return cached operations summary per window when fresh."""

    key = str(window or "1h").strip().lower() or "1h"
    now = time.monotonic()
    with _lock:
        entry = _ops_cache.get(key)
        if entry is not None and (now - entry.mono_ts) < _OPS_TTL_SEC:
            logger.debug("%s", {"stage": "connectors_ops_cache", "cache_hit": True, "window": key})
            return entry.value

    value = loader(db)
    with _lock:
        _ops_cache[key] = _CacheEntry(value=value, mono_ts=time.monotonic())
        logger.debug(
            "%s",
            {
                "stage": "connectors_ops_cache",
                "cache_miss": True,
                "window": key,
                "count": len(value.connectors),
            },
        )
    return value


def invalidate_connectors_list_fresh_cache() -> None:
    """Drop only the TTL-gated fresh list cache; preserve last-success stale rows."""

    with _lock:
        global _list_fresh
        _list_fresh = None


def patch_connectors_list_cache_connector(
    connector_id: int,
    *,
    last_auth_check_at: datetime | None = None,
    last_auth_check_status: str | None = None,
    last_auth_error: str | None = None,
) -> None:
    """Merge auth-check metadata into cached connector rows without dropping stale fallback."""

    patch: dict[str, object] = {}
    if last_auth_check_at is not None:
        patch["last_auth_check_at"] = last_auth_check_at
    if last_auth_check_status is not None:
        patch["last_auth_check_status"] = last_auth_check_status
    if last_auth_error is not None or last_auth_check_status == "success":
        patch["last_auth_error"] = last_auth_error

    if not patch:
        return

    def _patch_rows(rows: list[ConnectorRead]) -> list[ConnectorRead]:
        out: list[ConnectorRead] = []
        for row in rows:
            if int(row.id) == int(connector_id):
                out.append(row.model_copy(update=patch))
            else:
                out.append(row)
        return out

    with _lock:
        global _list_fresh, _list_stale
        if _list_fresh is not None:
            _list_fresh = _CacheEntry(value=_patch_rows(_list_fresh.value), mono_ts=_list_fresh.mono_ts)
        if _list_stale is not None:
            _list_stale = _CacheEntry(value=_patch_rows(_list_stale.value), mono_ts=_list_stale.mono_ts)


def invalidate_connectors_read_cache_after_auth_check(
    connector_id: int,
    *,
    last_auth_check_at: datetime | None,
    last_auth_check_status: str | None,
    last_auth_error: str | None,
) -> None:
    """Auth-check cache policy: expire fresh list only, patch stale rows, keep ops cache."""

    invalidate_connectors_list_fresh_cache()
    patch_connectors_list_cache_connector(
        connector_id,
        last_auth_check_at=last_auth_check_at,
        last_auth_check_status=last_auth_check_status,
        last_auth_error=last_auth_error,
    )


def clear_connectors_read_cache() -> None:
    """Drop all cached connector read payloads (create/update/delete mutations)."""

    with _lock:
        global _list_fresh, _list_stale
        _list_fresh = None
        _list_stale = None
        _ops_cache.clear()
