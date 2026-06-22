"""Catalog pool isolation for GET /connectors/."""

import concurrent.futures
import time

from sqlalchemy import text

from app.connectors.catalog_read import load_connectors_catalog_list
from app.connectors.read_cache import clear_connectors_read_cache
from app.connectors.router import _list_connectors_rows
from app.database import SessionLocal, catalog_engine, engine


def test_catalog_list_uses_isolated_pool_engine() -> None:
    assert catalog_engine is not engine


def test_catalog_list_responds_while_main_pool_exhausted() -> None:
    clear_connectors_read_cache()

    main_pool = engine.pool
    total = main_pool.size() + main_pool._max_overflow

    def hold_main_pool(_idx: int) -> None:
        db = SessionLocal()
        try:
            db.execute(text("SELECT pg_sleep(8)"))
        finally:
            db.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=total) as ex:
        holders = [ex.submit(hold_main_pool, i) for i in range(total)]
        time.sleep(0.3)
        started = time.perf_counter()
        rows = load_connectors_catalog_list(_list_connectors_rows)
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        concurrent.futures.wait(holders, timeout=15)

    assert isinstance(rows, list)
    assert elapsed_ms < 5000.0
