"""Connector operations summary aggregation helpers."""

from app.connectors.operations_service import _compute_event_trend_percent


def test_event_trend_percent_drop():
    # Case 3: last 1h=100, previous 1h=1000 → -90%
    assert _compute_event_trend_percent(100, 1000) == -90.0


def test_event_trend_percent_no_previous():
    assert _compute_event_trend_percent(100, 0) is None


def test_event_trend_percent_increase():
    assert _compute_event_trend_percent(200, 100) == 100.0
