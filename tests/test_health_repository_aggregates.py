"""Health repository aggregate window and scope guards."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.runtime.health_repository import clamp_health_aggregate_window


def test_clamp_health_aggregate_window_caps_at_24h() -> None:
    until = datetime(2026, 6, 22, 12, 0, tzinfo=UTC)
    since = until - timedelta(hours=48)
    start, end = clamp_health_aggregate_window(since, until)
    assert end == until
    assert start == until - timedelta(hours=24)


def test_clamp_health_aggregate_window_keeps_short_window() -> None:
    until = datetime(2026, 6, 22, 12, 0, tzinfo=UTC)
    since = until - timedelta(hours=1)
    start, end = clamp_health_aggregate_window(since, until)
    assert start == since
    assert end == until
