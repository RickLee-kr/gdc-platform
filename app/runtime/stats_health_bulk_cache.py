"""Process-local TTL cache for bulk stream stats-health reads."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Generic, TypeVar

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.observability.slow_query import pop_sql_thread_context, push_sql_thread_context
from app.runtime.schemas import BulkStreamStatsHealthResponse
from app.runtime.stats_health_bulk_service import get_bulk_stream_stats_health

logger = logging.getLogger(__name__)

_SOFT_TTL_SEC = 8.0
_HARD_TTL_SEC = 15.0

T = TypeVar("T")


@dataclass
class _CacheEntry(Generic[T]):
    value: T
    mono_ts: float


def _fetch_bulk(
    stream_ids: list[int],
    limit: int,
    window: str,
    snapshot_id: str | None,
    *,
    cache_hit_miss: str,
) -> BulkStreamStatsHealthResponse:
    push_sql_thread_context(
        endpoint="GET /api/v1/runtime/streams/stats-health/bulk",
        cache_hit_miss=cache_hit_miss,
    )
    db: Session = SessionLocal()
    try:
        return get_bulk_stream_stats_health(
            db,
            stream_ids,
            limit,
            window=window,
            snapshot_id=snapshot_id,
        )
    finally:
        db.close()
        pop_sql_thread_context()


class StatsHealthBulkReadCache:
    """Async-safe in-memory cache with soft/hard TTL and in-flight coalescing."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._entries: dict[str, _CacheEntry[BulkStreamStatsHealthResponse]] = {}
        self._inflight: dict[str, asyncio.Future[BulkStreamStatsHealthResponse]] = {}
        self._bg: dict[str, asyncio.Task[None]] = {}

    def clear(self) -> None:
        for task in list(self._bg.values()):
            task.cancel()
        self._bg.clear()
        for fut in self._inflight.values():
            if not fut.done():
                fut.cancel()
        self._inflight.clear()
        self._entries.clear()

    @staticmethod
    def _cache_key(stream_ids: list[int], limit: int, window: str, snapshot_id: str | None) -> str:
        ids_key = ",".join(str(int(x)) for x in sorted(set(stream_ids)))
        return f"{ids_key}|limit={int(limit)}|window={window}|snapshot={snapshot_id or 'fresh'}"

    def _schedule_refresh(
        self,
        key: str,
        stream_ids: list[int],
        limit: int,
        window: str,
        snapshot_id: str | None,
    ) -> None:
        if key in self._bg and not self._bg[key].done():
            return

        async def _job() -> None:
            try:
                val = await asyncio.to_thread(
                    _fetch_bulk,
                    stream_ids,
                    limit,
                    window,
                    snapshot_id,
                    cache_hit_miss="stale_background",
                )
                async with self._lock:
                    self._entries[key] = _CacheEntry(val, time.monotonic())
            except Exception:
                logger.exception(
                    "%s",
                    {"stage": "stats_health_bulk_cache", "event": "bg_refresh_failed", "cache_key": key},
                )
            finally:
                self._bg.pop(key, None)

        self._bg[key] = asyncio.create_task(_job())

    async def get_bulk(
        self,
        stream_ids: list[int],
        limit: int,
        window: str,
        snapshot_id: str | None = None,
    ) -> BulkStreamStatsHealthResponse:
        key = self._cache_key(stream_ids, limit, window, snapshot_id)
        now = time.monotonic()
        inflight: asyncio.Future[BulkStreamStatsHealthResponse] | None = None
        leader = False

        async with self._lock:
            ent = self._entries.get(key)
            if ent is not None:
                age = now - ent.mono_ts
                if age < _SOFT_TTL_SEC:
                    return ent.value
                if age < _HARD_TTL_SEC:
                    self._schedule_refresh(key, stream_ids, limit, window, snapshot_id)
                    return ent.value

            inflight = self._inflight.get(key)
            if inflight is None:
                loop = asyncio.get_running_loop()
                inflight = loop.create_future()
                self._inflight[key] = inflight
                leader = True

        if leader:
            assert inflight is not None
            try:
                val = await asyncio.to_thread(
                    _fetch_bulk,
                    stream_ids,
                    limit,
                    window,
                    snapshot_id,
                    cache_hit_miss="miss",
                )
                async with self._lock:
                    self._entries[key] = _CacheEntry(val, time.monotonic())
                    if not inflight.done():
                        inflight.set_result(val)
                    self._inflight.pop(key, None)
                return val
            except BaseException as exc:
                async with self._lock:
                    if not inflight.done():
                        inflight.set_exception(exc)
                    self._inflight.pop(key, None)
                raise

        assert inflight is not None
        return await inflight


stats_health_bulk_cache = StatsHealthBulkReadCache()


def clear_stats_health_bulk_cache() -> None:
    stats_health_bulk_cache.clear()
