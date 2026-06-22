"""Connectors catalog read cache."""

from unittest.mock import MagicMock

from app.connectors.read_cache import (
    clear_connectors_read_cache,
    get_connectors_list_cached,
    get_connectors_operations_summary_cached,
    invalidate_connectors_list_fresh_cache,
    invalidate_connectors_read_cache_after_auth_check,
    peek_connectors_list_cache,
    peek_connectors_list_stale_cache,
    resolve_connectors_list_catalog,
)
from app.connectors.operations_schemas import ConnectorOperationsSummaryResponse
from app.connectors.schemas import ConnectorRead


def _sample_connector(name: str = "Alpha") -> ConnectorRead:
    return ConnectorRead(
        id=1,
        name=name,
        description=None,
        status="STOPPED",
        connector_type="generic_http",
        source_type="HTTP_API_POLLING",
        source_id=1,
        stream_count=0,
        auth_type="no_auth",
        auth={"auth_type": "no_auth"},
        verify_ssl=True,
        common_headers={},
    )


def test_connectors_list_cache_reuses_loader_once(db_session) -> None:
    clear_connectors_read_cache()
    calls = {"n": 0}

    def loader(_db) -> list[ConnectorRead]:
        calls["n"] += 1
        return [_sample_connector()]

    first = get_connectors_list_cached(db_session, loader)
    second = get_connectors_list_cached(db_session, loader)
    assert first[0].name == "Alpha"
    assert second[0].name == "Alpha"
    assert calls["n"] == 1
    assert peek_connectors_list_cache() is not None
    assert peek_connectors_list_stale_cache() is not None
    clear_connectors_read_cache()
    assert peek_connectors_list_cache() is None
    assert peek_connectors_list_stale_cache() is None


def test_resolve_connectors_list_catalog_returns_stale_on_db_failure(monkeypatch) -> None:
    clear_connectors_read_cache()
    monkeypatch.setattr("app.connectors.read_cache._LIST_FRESH_TTL_SEC", 0.0)
    get_connectors_list_cached(MagicMock(), lambda _db: [_sample_connector("Cached")])
    assert peek_connectors_list_cache() is None
    assert peek_connectors_list_stale_cache() is not None

    def failing_loader() -> tuple[list[ConnectorRead], float, float]:
        raise TimeoutError("pool exhausted")

    rows, metrics = resolve_connectors_list_catalog(failing_loader)
    assert len(rows) == 1
    assert rows[0].name == "Cached"
    assert metrics.stale_fallback is True
    clear_connectors_read_cache()


def test_resolve_connectors_list_catalog_fresh_hit_skips_db_loader() -> None:
    clear_connectors_read_cache()
    get_connectors_list_cached(MagicMock(), lambda _db: [_sample_connector("Fresh")])

    def should_not_run() -> tuple[list[ConnectorRead], float, float]:
        raise AssertionError("db loader should not run on fresh cache hit")

    rows, metrics = resolve_connectors_list_catalog(should_not_run)
    assert rows[0].name == "Fresh"
    assert metrics.cache_hit is True
    clear_connectors_read_cache()


def test_connectors_operations_cache_is_window_scoped(db_session) -> None:
    clear_connectors_read_cache()
    calls = {"n": 0}

    def loader(_db) -> ConnectorOperationsSummaryResponse:
        calls["n"] += 1
        return ConnectorOperationsSummaryResponse(window="1h", generated_at=None, connectors=[])

    get_connectors_operations_summary_cached(db_session, window="1h", loader=loader)
    get_connectors_operations_summary_cached(db_session, window="1h", loader=loader)
    get_connectors_operations_summary_cached(db_session, window="15m", loader=loader)
    assert calls["n"] == 2


def test_invalidate_connectors_list_fresh_cache_preserves_stale() -> None:
    clear_connectors_read_cache()
    get_connectors_list_cached(MagicMock(), lambda _db: [_sample_connector("StaleKeep")])

    invalidate_connectors_list_fresh_cache()
    assert peek_connectors_list_cache() is None
    stale = peek_connectors_list_stale_cache()
    assert stale is not None
    assert stale[0].name == "StaleKeep"
    clear_connectors_read_cache()


def test_auth_check_invalidation_patches_stale_without_clearing_ops() -> None:
    from datetime import UTC, datetime

    clear_connectors_read_cache()
    get_connectors_list_cached(MagicMock(), lambda _db: [_sample_connector()])
    finished = datetime(2026, 6, 21, 12, 0, 0, tzinfo=UTC)
    invalidate_connectors_read_cache_after_auth_check(
        1,
        last_auth_check_at=finished,
        last_auth_check_status="success",
        last_auth_error=None,
    )
    stale = peek_connectors_list_stale_cache()
    assert stale is not None
    assert stale[0].last_auth_check_status == "success"
    clear_connectors_read_cache()
