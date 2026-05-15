"""DATABASE_QUERY adapter unit tests (mocked DB layer)."""

from __future__ import annotations

from typing import Any

import pytest

from app.sources.adapters.database_query import DatabaseQuerySourceAdapter


def test_database_query_adapter_emits_watermark_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    def _fake_fetch(
        *,
        source_config: dict[str, Any],
        stream_config: dict[str, Any],
        checkpoint: dict[str, Any] | None,
    ) -> list[dict[str, Any]]:
        return [{"id": 2, "event_time": "2024-01-02T00:00:00Z"}]

    monkeypatch.setattr(
        "app.sources.adapters.database_query.fetch_database_rows",
        lambda **kw: _fake_fetch(**kw),
    )

    ad = DatabaseQuerySourceAdapter()
    out = ad.fetch(
        {"db_type": "POSTGRESQL"},
        {
            "query": "SELECT id, event_time FROM security_events",
            "checkpoint_mode": "SINGLE_COLUMN",
            "checkpoint_column": "event_time",
            "max_rows_per_run": 10,
        },
        None,
    )
    assert len(out) == 1
    assert out[0]["gdc_db_watermark"] == "2024-01-02T00:00:00Z"


def test_registry_has_database_query() -> None:
    from app.pollers.http_poller import HttpPoller
    from app.sources.adapters.registry import SourceAdapterRegistry

    reg = SourceAdapterRegistry(http_poller=HttpPoller())
    assert reg.get("DATABASE_QUERY").__class__.__name__ == "DatabaseQuerySourceAdapter"
