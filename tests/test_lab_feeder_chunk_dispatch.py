"""Lab feeder dispatches webhook events in small chunks then discards payloads."""

from __future__ import annotations

from typing import Any

import pytest

from app.config import settings
from app.dev_validation_lab import lab_throughput_feeder as feeder


@pytest.fixture
def lab_chunk(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "GDC_LAB_FEED_DISPATCH_CHUNK_SIZE", 10, raising=False)


def test_webhook_lab_events_dispatch_in_chunks(lab_chunk: None, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def _fake_chunk(*, count: int) -> None:
        calls.append(int(count))

    monkeypatch.setattr(feeder, "_deliver_webhook_lab_events_chunk", _fake_chunk)
    feeder._deliver_webhook_lab_events(count=37)
    assert calls == [10, 10, 10, 7]


def test_postgres_insert_dispatch_in_chunks(lab_chunk: None, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, int]] = []

    def _fake_chunk(url: str, *, table: str, count: int) -> None:
        calls.append((table, int(count)))

    monkeypatch.setattr(feeder, "_insert_postgres_rows_chunk", _fake_chunk)
    feeder._insert_postgres_rows("postgresql://x", table="security_events", count=25)
    assert calls == [("security_events", 10), ("security_events", 10), ("security_events", 5)]
