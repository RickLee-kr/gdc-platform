"""Engine-level slow query logging (warning / critical thresholds)."""

from __future__ import annotations

import logging
import re
import threading
import time
from contextvars import ContextVar
from typing import Any

from sqlalchemy import event
from sqlalchemy.engine import Engine

from app.config import settings

logger = logging.getLogger(__name__)

_WARN_MS = 1000.0
_CRIT_MS = 3000.0

# Set per HTTP request by middleware (async worker / main request task).
http_sql_endpoint_cv: ContextVar[str] = ContextVar("gdc_http_sql_endpoint", default="")
http_sql_cache_cv: ContextVar[str] = ContextVar("gdc_http_sql_cache", default="n_a")

_thread_local = threading.local()
_installed_engine_ids: set[int] = set()


def push_sql_thread_context(*, endpoint: str | None, cache_hit_miss: str | None) -> None:
    """Attach endpoint + cache policy for SQL executed on a worker thread (e.g. dashboard cache DB fetch)."""

    _thread_local.sql_endpoint = endpoint
    _thread_local.sql_cache_hit_miss = cache_hit_miss


def pop_sql_thread_context() -> None:
    for attr in ("sql_endpoint", "sql_cache_hit_miss"):
        if hasattr(_thread_local, attr):
            delattr(_thread_local, attr)


def _active_endpoint() -> str:
    ep = getattr(_thread_local, "sql_endpoint", None)
    if isinstance(ep, str) and ep.strip():
        return ep.strip()
    cv = http_sql_endpoint_cv.get()
    if isinstance(cv, str) and cv.strip():
        return cv.strip()
    return "unknown"


def _active_cache_hit_miss() -> str:
    c = getattr(_thread_local, "sql_cache_hit_miss", None)
    if isinstance(c, str) and c.strip():
        return c.strip()
    cv = http_sql_cache_cv.get()
    if isinstance(cv, str) and cv.strip():
        return cv.strip()
    return "n_a"


def categorize_sql(statement: str) -> str:
    """Coarse category from SQL text for log filtering (best-effort, no ORM introspection)."""

    raw = statement.lower()
    if "delivery_log" in raw:
        return "delivery_logs"
    if "validation_run" in raw or "validation_recovery" in raw:
        return "validation"
    if "continuous_validation" in raw:
        return "continuous_validation"
    if "checkpoint" in raw:
        return "checkpoints"
    if "runtime_metric" in raw:
        return "runtime_metrics"
    if "backfill_progress" in raw:
        return "backfill_progress"
    if "backfill_job" in raw:
        return "backfill_jobs"
    s = re.sub(r'"[^"]+"', "", raw)
    s = re.sub(r"\s+", " ", s).strip()
    if " from stream" in s or " join stream" in s or " stream " in s:
        return "streams"
    if " from route" in s or " route " in s:
        return "routes"
    if " from destination" in s or " destination " in s:
        return "destinations"
    if " from connector" in s or " connector " in s:
        return "connectors"
    if " from source" in s or " source " in s:
        return "sources"
    if "mapping" in s and ("insert" in s or "update" in s or "delete" in s or " from " in s):
        return "mappings"
    return "other"


def _emit_slow(stage: str, duration_ms: float, statement: str) -> None:
    preview = statement.replace("\n", " ").strip()
    if len(preview) > 480:
        preview = preview[:477] + "..."
    base: dict[str, Any] = {
        "stage": stage,
        "slow_warn_ms": _WARN_MS,
        "slow_crit_ms": _CRIT_MS,
        "duration_ms": round(duration_ms, 3),
        "endpoint": _active_endpoint(),
        "query_category": categorize_sql(statement),
        "cache_hit_miss": _active_cache_hit_miss(),
        "statement_preview": preview,
    }
    if stage == "slow_sql_critical":
        logger.error("%s", base)
    else:
        logger.warning("%s", base)


def install_engine_listeners(engine: Engine) -> None:
    """Idempotent registration of before/after cursor timing on the given engine."""

    eid = id(engine)
    if eid in _installed_engine_ids:
        return
    _installed_engine_ids.add(eid)

    @event.listens_for(engine, "before_cursor_execute")
    def _before_cursor_execute(
        conn: Any,
        cursor: Any,
        statement: str,
        parameters: Any,
        context: Any,
        executemany: bool,
    ) -> None:
        if not settings.GDC_SLOW_QUERY_LOG:
            return
        d = conn.info.setdefault("_gdc_slow_t0", {})
        d[id(cursor)] = time.perf_counter()

    @event.listens_for(engine, "after_cursor_execute")
    def _after_cursor_execute(
        conn: Any,
        cursor: Any,
        statement: str,
        parameters: Any,
        context: Any,
        executemany: bool,
    ) -> None:
        if not settings.GDC_SLOW_QUERY_LOG:
            return
        d = conn.info.get("_gdc_slow_t0")
        if not isinstance(d, dict):
            return
        t0 = d.pop(id(cursor), None)
        if t0 is None:
            return
        elapsed_ms = (time.perf_counter() - float(t0)) * 1000.0
        if elapsed_ms < _WARN_MS:
            return
        if elapsed_ms >= _CRIT_MS:
            _emit_slow("slow_sql_critical", elapsed_ms, statement)
        else:
            _emit_slow("slow_sql_warning", elapsed_ms, statement)
