"""Pydantic schemas for delivery_logs analytics (read-only)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator

MetricMetaMap = dict[str, dict[str, Any]]
VisualizationMetaMap = dict[str, dict[str, Any]]


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
    window_start: datetime | None = None
    window_end: datetime | None = None
    snapshot_id: str | None = None
    generated_at: datetime | None = None

    @model_validator(mode="after")
    def _fill_aliases(self) -> "AnalyticsTimeWindow":
        if self.window_start is None:
            self.window_start = self.since
        if self.window_end is None:
            self.window_end = self.until
        if self.generated_at is None:
            self.generated_at = self.until
        if self.snapshot_id is None:
            self.snapshot_id = self.until.isoformat()
        return self


class FailureTotals(BaseModel):
    """Counts for route delivery outcome stages within the window."""

    failure_events: int = 0
    success_events: int = 0
    overall_failure_rate: float = 0.0


class DestinationDeliveryOutcomeRow(BaseModel):
    """Delivery outcome event totals grouped by destination."""

    destination_id: int
    success_events: int = 0
    failure_events: int = 0


class DestinationDeliveryOutcomesResponse(BaseModel):
    """GET /runtime/analytics/delivery-outcomes/destinations."""

    time: AnalyticsTimeWindow
    filters: AnalyticsScopeFilters
    metric_meta: MetricMetaMap = Field(default_factory=dict)
    visualization_meta: VisualizationMetaMap = Field(default_factory=dict)
    rows: list[DestinationDeliveryOutcomeRow] = Field(default_factory=list)


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
    metric_meta: MetricMetaMap = Field(default_factory=dict)
    visualization_meta: VisualizationMetaMap = Field(default_factory=dict)
    bucket_size_seconds: int | None = None
    bucket_count: int | None = None
    bucket_alignment: str | None = None
    bucket_timezone: str | None = None
    bucket_mode: str | None = None
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
    metric_meta: MetricMetaMap = Field(default_factory=dict)
    visualization_meta: VisualizationMetaMap = Field(default_factory=dict)
    bucket_size_seconds: int | None = None
    bucket_count: int | None = None
    bucket_alignment: str | None = None
    bucket_timezone: str | None = None
    bucket_mode: str | None = None
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
    metric_meta: MetricMetaMap = Field(default_factory=dict)
    visualization_meta: VisualizationMetaMap = Field(default_factory=dict)
    retry_heavy_streams: list[StreamRetryRow] = Field(default_factory=list)
    retry_heavy_routes: list[RouteRetryRow] = Field(default_factory=list)


class RetrySummaryResponse(BaseModel):
    """GET /runtime/analytics/retries/summary — KPI-friendly retry totals."""

    time: AnalyticsTimeWindow
    filters: AnalyticsScopeFilters
    metric_meta: MetricMetaMap = Field(default_factory=dict)
    visualization_meta: VisualizationMetaMap = Field(default_factory=dict)
    retry_success_events: int = 0
    retry_failed_events: int = 0
    total_retry_outcome_events: int = 0
    retry_column_sum: int = 0

