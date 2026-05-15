"""Pydantic schemas for delivery_logs analytics (read-only)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class AnalyticsScopeFilters(BaseModel):
    """Optional narrowers — all AND-ed with the time window."""

    stream_id: int | None = None
    route_id: int | None = None
    destination_id: int | None = None


class AnalyticsTimeWindow(BaseModel):
    """Resolved query window metadata."""

    window: str = Field(description="Normalized metrics window token (15m, 1h, 6h, 24h).")
    since: datetime
    until: datetime


class FailureTotals(BaseModel):
    """Counts for route delivery outcome stages within the window."""

    failure_events: int = 0
    success_events: int = 0
    overall_failure_rate: float = 0.0


class RouteOutcomeRow(BaseModel):
    """Per-route delivery outcomes (only rows with route_id)."""

    route_id: int
    stream_id: int | None = None
    destination_id: int | None = None
    failure_count: int = 0
    success_count: int = 0
    failure_rate: float = 0.0
    last_failure_at: datetime | None = None
    last_success_at: datetime | None = None


class DimensionCount(BaseModel):
    """Grouped failure totals."""

    id: int | None = None
    failure_count: int = 0


class FailureTrendBucket(BaseModel):
    """Time-bucketed failure counts."""

    bucket_start: datetime
    failure_count: int = 0


class CodeCount(BaseModel):
    """error_code histogram entry."""

    error_code: str | None = None
    count: int = 0


class StageCount(BaseModel):
    """stage histogram entry (failure-class stages)."""

    stage: str
    count: int = 0


class UnstableRouteCandidate(BaseModel):
    """Heuristic unstable route — high failure rate with enough samples."""

    route_id: int
    stream_id: int | None = None
    destination_id: int | None = None
    failure_count: int = 0
    success_count: int = 0
    failure_rate: float = 0.0
    sample_total: int = 0


class RouteFailuresAnalyticsResponse(BaseModel):
    """GET /runtime/analytics/routes/failures — aggregate route failure analytics."""

    time: AnalyticsTimeWindow
    filters: AnalyticsScopeFilters
    totals: FailureTotals
    latency_ms_avg: float | None = None
    latency_ms_p95: float | None = None
    last_failure_at: datetime | None = None
    last_success_at: datetime | None = None
    outcomes_by_route: list[RouteOutcomeRow] = Field(default_factory=list)
    failures_by_destination: list[DimensionCount] = Field(default_factory=list)
    failures_by_stream: list[DimensionCount] = Field(default_factory=list)
    failure_trend: list[FailureTrendBucket] = Field(default_factory=list)
    top_error_codes: list[CodeCount] = Field(default_factory=list)
    top_failed_stages: list[StageCount] = Field(default_factory=list)
    unstable_routes: list[UnstableRouteCandidate] = Field(default_factory=list)


class RouteFailuresScopedResponse(BaseModel):
    """GET /runtime/analytics/routes/{route_id}/failures — same metrics scoped to one route."""

    route_id: int
    time: AnalyticsTimeWindow
    filters: AnalyticsScopeFilters
    totals: FailureTotals
    latency_ms_avg: float | None = None
    latency_ms_p95: float | None = None
    last_failure_at: datetime | None = None
    last_success_at: datetime | None = None
    failures_by_destination: list[DimensionCount] = Field(default_factory=list)
    failure_trend: list[FailureTrendBucket] = Field(default_factory=list)
    top_error_codes: list[CodeCount] = Field(default_factory=list)
    top_failed_stages: list[StageCount] = Field(default_factory=list)


class StreamRetryRow(BaseModel):
    """Retry-heavy stream ranking."""

    stream_id: int
    retry_event_count: int = 0
    retry_column_sum: int = 0


class RouteRetryRow(BaseModel):
    """Retry-heavy route ranking."""

    route_id: int
    retry_event_count: int = 0
    retry_column_sum: int = 0


class StreamRetriesAnalyticsResponse(BaseModel):
    """GET /runtime/analytics/streams/retries — retry-focused aggregates."""

    time: AnalyticsTimeWindow
    filters: AnalyticsScopeFilters
    retry_heavy_streams: list[StreamRetryRow] = Field(default_factory=list)
    retry_heavy_routes: list[RouteRetryRow] = Field(default_factory=list)


class RetrySummaryResponse(BaseModel):
    """GET /runtime/analytics/retries/summary — KPI-friendly retry totals."""

    time: AnalyticsTimeWindow
    filters: AnalyticsScopeFilters
    retry_success_events: int = 0
    retry_failed_events: int = 0
    total_retry_outcome_events: int = 0
    retry_column_sum: int = 0

