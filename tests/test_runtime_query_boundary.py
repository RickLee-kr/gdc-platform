"""Query boundary taxonomy (Phase 6)."""

from __future__ import annotations

from app.runtime.query_boundary import (
    classify_query_category,
    select_aggregate_query_path,
)


def test_classify_operational_snapshot() -> None:
    assert classify_query_category("runtime_operational_snapshot") == "runtime_operational_snapshot"
    assert classify_query_category("runtime_dashboard_summary") == "runtime_operational_snapshot"


def test_classify_analytics_bucket() -> None:
    assert classify_query_category("runtime_dashboard_outcome_timeseries") == "runtime_analytics_bucket"
    assert classify_query_category("runtime_analytics_route_failures") == "runtime_analytics_bucket"


def test_classify_forensic_default() -> None:
    assert classify_query_category("runtime_logs_search") == "runtime_forensic_logs"
    assert classify_query_category("runtime_analytics_top_error_codes") == "runtime_forensic_logs"


def test_select_aggregate_path_historical_analytics() -> None:
    assert select_aggregate_query_path("analytics_route_failures") == "historical"
    assert select_aggregate_query_path("runtime_dashboard_outcome_timeseries") == "historical"


def test_select_aggregate_path_live_dashboard() -> None:
    assert select_aggregate_query_path("runtime_dashboard_summary") == "live"
