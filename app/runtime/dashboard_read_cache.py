"""Process-local stale-safe TTL cache for heavy runtime dashboard read endpoints.

Runs synchronous SQLAlchemy work in ``asyncio.to_thread`` so the uvicorn event
loop stays responsive. Coalesces concurrent refreshes per cache key.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, Callable, Generic, TypeVar

from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.observability.slow_query import pop_sql_thread_context, push_sql_thread_context
from app.runtime import read_service
from app.runtime.schemas import DashboardOutcomeTimeseriesResponse, DashboardSummaryResponse
from app.runtime.snapshot_materialization import get_or_materialize_snapshot

logger = logging.getLogger(__name__)

# Fresh window (seconds). Within this, serve cache only (no DB on request path).
_SOFT_TTL_SEC = 8.0
# Max staleness (seconds). Beyond soft TTL but within hard TTL: serve cache and
# refresh in background. After hard TTL: await coalesced DB read (still in thread pool).
_HARD_TTL_SEC = 15.0

_READ_STATEMENT_TIMEOUT_MS = 8000

T = TypeVar("T")


def _read_session() -> Session:
    db = SessionLocal()
    db.execute(text(f"SET LOCAL statement_timeout = '{int(_READ_STATEMENT_TIMEOUT_MS)}ms'"))
    return db


def _run_with_session(
    fn: Callable[[Session], T],
    *,
    sql_thread_endpoint: str | None = None,
    sql_thread_cache: str | None = None,
) -> T:
    if sql_thread_endpoint is not None:
        push_sql_thread_context(endpoint=sql_thread_endpoint, cache_hit_miss=sql_thread_cache or "n_a")
    try:
        db = _read_session()
        try:
            return fn(db)
        finally:
            db.close()
    finally:
        if sql_thread_endpoint is not None:
            pop_sql_thread_context()


def _is_statement_timeout(exc: BaseException) -> bool:
    s = str(exc).lower()
    return "statement timeout" in s or "canceling statement due to statement timeout" in s


def _fetch_summary(limit: int, window: str, snapshot_id: str | None, *, cache_hit_miss: str) -> DashboardSummaryResponse:
    try:
        return _run_with_session(
            lambda db: get_or_materialize_snapshot(
                db,
                scope="dashboard_summary",
                key=f"limit={int(limit)};window={window}",
                snapshot_id=snapshot_id,
                model_type=DashboardSummaryResponse,
                builder=lambda: read_service.get_runtime_dashboard_summary(db, limit, window=window, snapshot_id=snapshot_id),
            )
            if snapshot_id
            else read_service.get_runtime_dashboard_summary(db, limit, window=window, snapshot_id=snapshot_id),
            sql_thread_endpoint="GET /api/v1/runtime/dashboard/summary",
            sql_thread_cache=cache_hit_miss,
        )
    except OperationalError as exc:
        if _is_statement_timeout(exc):
            _log_dashboard_metric("dashboard_fetch_timeout", endpoint="summary", detail=str(exc)[:300])
        raise


def _fetch_outcome(window: str, snapshot_id: str | None, *, cache_hit_miss: str) -> DashboardOutcomeTimeseriesResponse:
    try:
        return _run_with_session(
            lambda db: get_or_materialize_snapshot(
                db,
                scope="dashboard_outcome_timeseries",
                key=f"window={window}",
                snapshot_id=snapshot_id,
                model_type=DashboardOutcomeTimeseriesResponse,
                builder=lambda: read_service.get_dashboard_outcome_timeseries(db, window=window, snapshot_id=snapshot_id),
            )
            if snapshot_id
            else read_service.get_dashboard_outcome_timeseries(db, window=window, snapshot_id=snapshot_id),
            sql_thread_endpoint="GET /api/v1/runtime/dashboard/outcome-timeseries",
            sql_thread_cache=cache_hit_miss,
        )
    except OperationalError as exc:
        if _is_statement_timeout(exc):
            _log_dashboard_metric("dashboard_fetch_timeout", endpoint="outcome_timeseries", detail=str(exc)[:300])
        raise


def _log_dashboard_metric(metric: str, **fields: Any) -> None:
    payload: dict[str, Any] = {"stage": "dashboard_operational", "metric": metric, **fields}
    logger.info("%s", payload)


@dataclass
class _CacheEntry(Generic[T]):
    value: T
    mono_ts: float


class DashboardReadCache:
    """Async-safe in-memory cache with soft/hard TTL and in-flight coalescing."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._summary: dict[str, _CacheEntry[DashboardSummaryResponse]] = {}
        self._outcome: dict[str, _CacheEntry[DashboardOutcomeTimeseriesResponse]] = {}
        self._summary_inflight: dict[str, asyncio.Future[DashboardSummaryResponse]] = {}
        self._outcome_inflight: dict[str, asyncio.Future[DashboardOutcomeTimeseriesResponse]] = {}
        self._summary_bg: dict[str, asyncio.Task[None]] = {}
        self._outcome_bg: dict[str, asyncio.Task[None]] = {}

    def clear(self) -> None:
        """Drop cached entries and cancel background refresh tasks (tests / admin hooks)."""

        for t in list(self._summary_bg.values()):
            t.cancel()
        for t in list(self._outcome_bg.values()):
            t.cancel()
        self._summary_bg.clear()
        self._outcome_bg.clear()
        for fut in self._summary_inflight.values():
            if not fut.done():
                fut.cancel()
        for fut in self._outcome_inflight.values():
            if not fut.done():
                fut.cancel()
        self._summary_inflight.clear()
        self._outcome_inflight.clear()
        self._summary.clear()
        self._outcome.clear()

    def _summary_key(self, limit: int, window: str, snapshot_id: str | None) -> str:
        return f"{int(limit)}:{window}:{snapshot_id or 'fresh'}"

    def _outcome_key(self, window: str, snapshot_id: str | None) -> str:
        return f"{window}:{snapshot_id or 'fresh'}"

    def _schedule_summary_refresh(self, key: str, limit: int, window: str, snapshot_id: str | None) -> None:
        if key in self._summary_bg and not self._summary_bg[key].done():
            return

        async def _job() -> None:
            try:
                val = await asyncio.to_thread(_fetch_summary, limit, window, snapshot_id, cache_hit_miss="stale_background")
                async with self._lock:
                    self._summary[key] = _CacheEntry(val, time.monotonic())
            except Exception:
                logger.exception(
                    "%s",
                    {"stage": "dashboard_read_cache", "event": "summary_bg_refresh_failed", "cache_key": key},
                )
            finally:
                self._summary_bg.pop(key, None)

        self._summary_bg[key] = asyncio.create_task(_job())

    def _schedule_outcome_refresh(self, key: str, window: str, snapshot_id: str | None) -> None:
        if key in self._outcome_bg and not self._outcome_bg[key].done():
            return

        async def _job() -> None:
            try:
                val = await asyncio.to_thread(_fetch_outcome, window, snapshot_id, cache_hit_miss="stale_background")
                async with self._lock:
                    self._outcome[key] = _CacheEntry(val, time.monotonic())
            except Exception:
                logger.exception(
                    "%s",
                    {"stage": "dashboard_read_cache", "event": "outcome_bg_refresh_failed", "cache_key": key},
                )
            finally:
                self._outcome_bg.pop(key, None)

        self._outcome_bg[key] = asyncio.create_task(_job())

    async def get_summary(self, limit: int, window: str, snapshot_id: str | None = None) -> DashboardSummaryResponse:
        key = self._summary_key(limit, window, snapshot_id)
        now = time.monotonic()
        inflight: asyncio.Future[DashboardSummaryResponse] | None = None
        leader = False

        async with self._lock:
            ent = self._summary.get(key)
            if ent is not None:
                age = now - ent.mono_ts
                if age < _SOFT_TTL_SEC:
                    _log_dashboard_metric("dashboard_cache_hit", endpoint="summary", cache_key=key, cache_age_sec=round(age, 3))
                    return ent.value
                if age < _HARD_TTL_SEC:
                    _log_dashboard_metric(
                        "dashboard_cache_hit",
                        endpoint="summary",
                        cache_key=key,
                        cache_age_sec=round(age, 3),
                        stale_while_revalidate=True,
                    )
                    self._schedule_summary_refresh(key, limit, window, snapshot_id)
                    return ent.value

            inflight = self._summary_inflight.get(key)
            if inflight is None:
                loop = asyncio.get_running_loop()
                inflight = loop.create_future()
                self._summary_inflight[key] = inflight
                leader = True

        if leader:
            assert inflight is not None
            try:
                val = await asyncio.to_thread(_fetch_summary, limit, window, snapshot_id, cache_hit_miss="miss")
                async with self._lock:
                    self._summary[key] = _CacheEntry(val, time.monotonic())
                    if not inflight.done():
                        inflight.set_result(val)
                    self._summary_inflight.pop(key, None)
                _log_dashboard_metric("dashboard_cache_miss", endpoint="summary", cache_key=key)
                return val
            except BaseException as exc:
                async with self._lock:
                    if not inflight.done():
                        inflight.set_exception(exc)
                    self._summary_inflight.pop(key, None)
                raise

        assert inflight is not None
        return await inflight

    async def get_outcome_timeseries(
        self,
        window: str,
        snapshot_id: str | None = None,
    ) -> DashboardOutcomeTimeseriesResponse:
        key = self._outcome_key(window, snapshot_id)
        now = time.monotonic()
        inflight: asyncio.Future[DashboardOutcomeTimeseriesResponse] | None = None
        leader = False

        async with self._lock:
            ent = self._outcome.get(key)
            if ent is not None:
                age = now - ent.mono_ts
                if age < _SOFT_TTL_SEC:
                    _log_dashboard_metric("dashboard_cache_hit", endpoint="outcome_timeseries", cache_key=key, cache_age_sec=round(age, 3))
                    return ent.value
                if age < _HARD_TTL_SEC:
                    _log_dashboard_metric(
                        "dashboard_cache_hit",
                        endpoint="outcome_timeseries",
                        cache_key=key,
                        cache_age_sec=round(age, 3),
                        stale_while_revalidate=True,
                    )
                    self._schedule_outcome_refresh(key, window, snapshot_id)
                    return ent.value

            inflight = self._outcome_inflight.get(key)
            if inflight is None:
                loop = asyncio.get_running_loop()
                inflight = loop.create_future()
                self._outcome_inflight[key] = inflight
                leader = True

        if leader:
            assert inflight is not None
            try:
                val = await asyncio.to_thread(_fetch_outcome, window, snapshot_id, cache_hit_miss="miss")
                async with self._lock:
                    self._outcome[key] = _CacheEntry(val, time.monotonic())
                    if not inflight.done():
                        inflight.set_result(val)
                    self._outcome_inflight.pop(key, None)
                _log_dashboard_metric("dashboard_cache_miss", endpoint="outcome_timeseries", cache_key=key)
                return val
            except BaseException as exc:
                async with self._lock:
                    if not inflight.done():
                        inflight.set_exception(exc)
                    self._outcome_inflight.pop(key, None)
                raise

        assert inflight is not None
        return await inflight


dashboard_read_cache = DashboardReadCache()


def clear_dashboard_read_cache() -> None:
    """Module-level helper for tests."""

    dashboard_read_cache.clear()
