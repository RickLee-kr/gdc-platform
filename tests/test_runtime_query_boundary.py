"""Live vs historical aggregate query boundary selection."""

from __future__ import annotations

from app.runtime.query_boundary import select_aggregate_query_path


def test_live_surfaces_select_live_query_path() -> None:
    assert select_aggregate_query_path("runtime_dashboard_summary") == "live"
    assert select_aggregate_query_path("runtime_dashboard_outcome_timeseries") == "live"
    assert select_aggregate_query_path("stream_runtime_metrics") == "live"
    assert select_aggregate_query_path("routes_overview", scoring_mode="current_runtime") == "live"


def test_analytics_surfaces_select_historical_query_path() -> None:
    assert select_aggregate_query_path("runtime_analytics") == "historical"
    assert select_aggregate_query_path("analytics_route_failures") == "historical"
    assert select_aggregate_query_path("analytics_delivery_outcomes_by_destination") == "historical"
    assert select_aggregate_query_path("routes_overview", scoring_mode="historical_analytics") == "historical"
