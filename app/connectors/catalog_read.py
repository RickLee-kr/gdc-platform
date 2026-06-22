"""Isolated catalog read path for GET /connectors/ — separate DB pool from analytics."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.connectors.read_cache import resolve_connectors_list_catalog
from app.connectors.schemas import ConnectorRead
from app.database import CatalogSessionLocal, _GDC_READ_STATEMENT_TIMEOUT_MS

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CatalogConnectorsListMetrics:
    cache_hit: bool = False
    cache_miss: bool = False
    stale_fallback: bool = False
    pool_wait_ms: float | None = None
    db_load_ms: float | None = None
    response_ms: float | None = None
    count: int = 0


def _open_catalog_read_session() -> tuple[Session, float]:
    """Acquire a catalog-pool session; ``pool_wait_ms`` covers queue + connect until first ping."""

    started = time.perf_counter()
    db = CatalogSessionLocal()
    try:
        db.execute(text(f"SET LOCAL statement_timeout = '{int(_GDC_READ_STATEMENT_TIMEOUT_MS)}ms'"))
        db.execute(text("SELECT 1"))
    except Exception:
        db.close()
        raise
    pool_wait_ms = round((time.perf_counter() - started) * 1000.0, 3)
    return db, pool_wait_ms


def _load_connectors_from_catalog_db(loader: Callable[[Session], list[ConnectorRead]]) -> tuple[list[ConnectorRead], float, float]:
    db, pool_wait_ms = _open_catalog_read_session()
    db_started = time.perf_counter()
    try:
        rows = loader(db)
        db_load_ms = round((time.perf_counter() - db_started) * 1000.0, 3)
        return rows, pool_wait_ms, db_load_ms
    finally:
        db.close()


def load_connectors_catalog_list(loader: Callable[[Session], list[ConnectorRead]]) -> list[ConnectorRead]:
    """Return connectors catalog rows using cache-first + catalog pool + stale fallback."""

    response_started = time.perf_counter()

    def db_loader() -> tuple[list[ConnectorRead], float, float]:
        return _load_connectors_from_catalog_db(loader)

    rows, metrics = resolve_connectors_list_catalog(db_loader)
    response_ms = round((time.perf_counter() - response_started) * 1000.0, 3)

    log_payload = {
        "stage": "catalog_connectors_list",
        "catalog_connectors_cache_hit": metrics.cache_hit,
        "catalog_connectors_cache_miss": metrics.cache_miss,
        "catalog_connectors_stale_fallback": metrics.stale_fallback,
        "catalog_connectors_count": len(rows),
        "catalog_connectors_response_ms": response_ms,
    }
    if metrics.pool_wait_ms is not None:
        log_payload["catalog_connectors_pool_wait_ms"] = metrics.pool_wait_ms
    if metrics.db_load_ms is not None:
        log_payload["catalog_connectors_db_load_ms"] = metrics.db_load_ms

    if metrics.stale_fallback:
        logger.warning("%s", log_payload)
    else:
        logger.info("%s", log_payload)

    return rows
