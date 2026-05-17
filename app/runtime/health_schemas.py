"""Pydantic schemas for deterministic runtime health scoring (read-only).

Health surfaces operational stability of streams, routes, and destinations using
deterministic factors over `delivery_logs`. There is no ML scoring.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.runtime.analytics_schemas import AnalyticsScopeFilters, AnalyticsTimeWindow, MetricMetaMap

HealthLevel = Literal["HEALTHY", "DEGRADED", "UNHEALTHY", "CRITICAL"]
ScoringMode = Literal["current_runtime", "historical_analytics"]


class HealthFactor(BaseModel):
    """One contributing factor that explains the score delta."""

    code: str = Field(description="Stable factor identifier (e.g. failure_rate).")
    label: str = Field(description="Human-readable factor label.")
    delta: int = Field(description="Negative integer applied to the score.")
    detail: str | None = Field(
        default=None,
        description="Short operator-friendly explanation (numbers, thresholds).",
    )


class HealthMetrics(BaseModel):
    """Raw inputs that drove the score (operator can audit)."""

    failure_count: int = 0
    success_count: int = 0
    retry_event_count: int = 0
    retry_count_sum: int = 0
    failure_rate: float = 0.0
    retry_rate: float = 0.0
    latency_ms_avg: float | None = None
    latency_ms_p95: float | None = None
    last_failure_at: datetime | None = None
    last_success_at: datetime | None = None
    historical_failure_count: int = Field(
        default=0,
        description="Failure outcomes in the full analytics window (audit / Analytics).",
    )
    historical_delivery_failure_rate: float = Field(
        default=0.0,
        description="Failures / (failures + successes) over the full window.",
    )
    live_delivery_failure_rate: float = Field(
        default=0.0,
        description="Failures / (failures + successes) in the recent posture slice.",
    )
    recent_success_ratio: float = Field(
        default=0.0,
        description="Success share in the recent posture slice (0..1).",
    )
    health_recovery_score: float = Field(
        default=0.0,
        description="0..1 blend of recent success and recovery after last failure.",
    )
    recent_failure_count: int = Field(
        default=0,
        description="Failure outcomes in the recent posture slice (current_runtime window).",
    )
    recent_success_count: int = Field(
        default=0,
        description="Success outcomes in the recent posture slice.",
    )
    recent_failure_rate: float = Field(
        default=0.0,
        description="Failures / (failures + successes) in the recent posture slice.",
    )
    recent_window_since: datetime | None = Field(
        default=None,
        description="UTC start of the recent posture slice (inclusive).",
    )
    recent_window_until: datetime | None = Field(
        default=None,
        description="UTC end of the recent posture slice (inclusive).",
    )
    current_runtime_health: HealthLevel | None = Field(
        default=None,
        description="Live posture level when scoring_mode is historical_analytics.",
    )


class HealthScore(BaseModel):
    """Score envelope shared by all health responses."""

    score: int = Field(ge=0, le=100, description="Deterministic operational score 0..100.")
    level: HealthLevel = Field(description="Bucketed operational health level.")
    factors: list[HealthFactor] = Field(default_factory=list)
    metrics: HealthMetrics
    scoring_mode: ScoringMode = Field(
        default="current_runtime",
        description="current_runtime = live posture; historical_analytics = full-window trend.",
    )


class StreamHealthRow(BaseModel):
    """Per-stream operational health row."""

    stream_id: int
    stream_name: str | None = None
    connector_id: int | None = None
    score: int
    level: HealthLevel
    factors: list[HealthFactor] = Field(default_factory=list)
    metrics: HealthMetrics


class RouteHealthRow(BaseModel):
    """Per-route operational health row."""

    route_id: int
    stream_id: int | None = None
    destination_id: int | None = None
    score: int
    level: HealthLevel
    factors: list[HealthFactor] = Field(default_factory=list)
    metrics: HealthMetrics


class DestinationHealthRow(BaseModel):
    """Per-destination operational health row."""

    destination_id: int
    destination_name: str | None = None
    destination_type: str | None = None
    score: int
    level: HealthLevel
    factors: list[HealthFactor] = Field(default_factory=list)
    metrics: HealthMetrics


class HealthLevelBreakdown(BaseModel):
    """Counts of entities per health level."""

    healthy: int = 0
    degraded: int = 0
    unhealthy: int = 0
    critical: int = 0
    idle: int = Field(
        default=0,
        description="Configured enabled entities with no scoreable delivery outcomes in the window.",
    )
    disabled: int = Field(
        default=0,
        description="Configured entities disabled by route/destination config.",
    )


class HealthOverviewResponse(BaseModel):
    """GET /runtime/health/overview — KPI summary across streams/routes/destinations."""

    time: AnalyticsTimeWindow
    filters: AnalyticsScopeFilters
    scoring_mode: ScoringMode = Field(
        default="current_runtime",
        description="Aggregation model used for level buckets and scores.",
    )
    metric_meta: MetricMetaMap = Field(default_factory=dict)
    streams: HealthLevelBreakdown
    routes: HealthLevelBreakdown
    destinations: HealthLevelBreakdown
    average_stream_score: float | None = None
    average_route_score: float | None = None
    average_destination_score: float | None = None
    worst_routes: list[RouteHealthRow] = Field(default_factory=list)
    worst_streams: list[StreamHealthRow] = Field(default_factory=list)
    worst_destinations: list[DestinationHealthRow] = Field(default_factory=list)


class StreamHealthListResponse(BaseModel):
    """GET /runtime/health/streams — per-stream health rows ordered by score asc."""

    time: AnalyticsTimeWindow
    filters: AnalyticsScopeFilters
    scoring_mode: ScoringMode = "current_runtime"
    metric_meta: MetricMetaMap = Field(default_factory=dict)
    rows: list[StreamHealthRow] = Field(default_factory=list)


class RouteHealthListResponse(BaseModel):
    """GET /runtime/health/routes — per-route health rows ordered by score asc."""

    time: AnalyticsTimeWindow
    filters: AnalyticsScopeFilters
    scoring_mode: ScoringMode = "current_runtime"
    metric_meta: MetricMetaMap = Field(default_factory=dict)
    rows: list[RouteHealthRow] = Field(default_factory=list)


class DestinationHealthListResponse(BaseModel):
    """GET /runtime/health/destinations — per-destination health rows ordered by score asc."""

    time: AnalyticsTimeWindow
    filters: AnalyticsScopeFilters
    scoring_mode: ScoringMode = "current_runtime"
    metric_meta: MetricMetaMap = Field(default_factory=dict)
    rows: list[DestinationHealthRow] = Field(default_factory=list)


class StreamHealthDetailResponse(BaseModel):
    """GET /runtime/health/streams/{stream_id} — single stream health envelope."""

    time: AnalyticsTimeWindow
    filters: AnalyticsScopeFilters
    stream_id: int
    stream_name: str | None = None
    connector_id: int | None = None
    score: HealthScore


class RouteHealthDetailResponse(BaseModel):
    """GET /runtime/health/routes/{route_id} — single route health envelope."""

    time: AnalyticsTimeWindow
    filters: AnalyticsScopeFilters
    route_id: int
    stream_id: int | None = None
    destination_id: int | None = None
    score: HealthScore
