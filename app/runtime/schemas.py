"""Pydantic schemas for runtime read-only APIs."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class CheckpointStatsPayload(BaseModel):
    """Checkpoint snapshot for runtime stats (read-only)."""

    type: str
    value: dict[str, Any] = Field(default_factory=dict)


class StreamRuntimeSummary(BaseModel):
    """Stage counts within the recent delivery_logs window."""

    total_logs: int = 0
    route_send_success: int = 0
    route_send_failed: int = 0
    route_retry_success: int = 0
    route_retry_failed: int = 0
    route_skip: int = 0
    source_rate_limited: int = 0
    destination_rate_limited: int = 0
    route_unknown_failure_policy: int = 0
    run_complete: int = 0


class StreamRuntimeLastSeen(BaseModel):
    """Most recent timestamps by outcome within the recent logs window."""

    success_at: datetime | None = None
    failure_at: datetime | None = None
    rate_limited_at: datetime | None = None


class RouteRuntimeCounts(BaseModel):
    """Per-route stage counts within the recent delivery_logs window."""

    route_send_success: int = 0
    route_send_failed: int = 0
    route_retry_success: int = 0
    route_retry_failed: int = 0
    destination_rate_limited: int = 0
    route_skip: int = 0
    route_unknown_failure_policy: int = 0


class RouteRuntimeStatsItem(BaseModel):
    """One route row with destination context and log-derived stats."""

    route_id: int
    destination_id: int
    destination_type: str
    enabled: bool
    failure_policy: str
    status: str
    counts: RouteRuntimeCounts
    last_success_at: datetime | None = None
    last_failure_at: datetime | None = None


class RecentDeliveryLogItem(BaseModel):
    """Subset of delivery_logs for UI (no payload_sample)."""

    id: int
    stage: str
    level: str
    status: str | None = None
    message: str
    route_id: int | None = None
    destination_id: int | None = None
    error_code: str | None = None
    created_at: datetime


class StreamRuntimeStatsResponse(BaseModel):
    """GET /runtime/stats/stream/{stream_id} response body."""

    stream_id: int
    stream_status: str
    checkpoint: CheckpointStatsPayload | None = None
    summary: StreamRuntimeSummary
    last_seen: StreamRuntimeLastSeen
    routes: list[RouteRuntimeStatsItem]
    recent_logs: list[RecentDeliveryLogItem]


StreamHealthState = Literal["HEALTHY", "DEGRADED", "UNHEALTHY", "IDLE"]
RouteHealthState = Literal["DISABLED", "HEALTHY", "DEGRADED", "UNHEALTHY", "IDLE"]


class StreamHealthSummary(BaseModel):
    """Route health bucket counts for dashboard."""

    total_routes: int = 0
    healthy_routes: int = 0
    degraded_routes: int = 0
    unhealthy_routes: int = 0
    disabled_routes: int = 0
    idle_routes: int = 0


class RouteHealthItem(BaseModel):
    """Per-route delivery health derived from recent delivery_logs."""

    route_id: int
    destination_id: int
    destination_type: str
    route_enabled: bool
    destination_enabled: bool
    failure_policy: str
    route_status: str
    health: RouteHealthState
    success_count: int = 0
    failure_count: int = 0
    rate_limited_count: int = 0
    consecutive_failure_count: int = 0
    last_success_at: datetime | None = None
    last_failure_at: datetime | None = None
    last_rate_limited_at: datetime | None = None
    last_error_code: str | None = None
    last_error_message: str | None = None


class StreamHealthResponse(BaseModel):
    """GET /runtime/health/stream/{stream_id} response body."""

    stream_id: int
    stream_status: str
    health: StreamHealthState
    limit: int
    summary: StreamHealthSummary
    routes: list[RouteHealthItem]


class DashboardSummaryNumbers(BaseModel):
    """Aggregate counts for the runtime dashboard (DB + recent logs window)."""

    total_streams: int = 0
    running_streams: int = 0
    paused_streams: int = 0
    error_streams: int = 0
    stopped_streams: int = 0
    rate_limited_source_streams: int = 0
    rate_limited_destination_streams: int = 0
    total_routes: int = 0
    enabled_routes: int = 0
    disabled_routes: int = 0
    total_destinations: int = 0
    enabled_destinations: int = 0
    disabled_destinations: int = 0
    recent_logs: int = 0
    recent_successes: int = 0
    recent_failures: int = 0
    recent_rate_limited: int = 0


class RecentProblemRouteItem(BaseModel):
    """One recent failure log row tied to a route."""

    stream_id: int
    route_id: int
    destination_id: int | None = None
    stage: str
    error_code: str | None = None
    message: str
    created_at: datetime


class RecentRateLimitedRouteItem(BaseModel):
    """One recent destination_rate_limited log tied to a route."""

    stream_id: int
    route_id: int
    destination_id: int | None = None
    stage: str
    error_code: str | None = None
    message: str
    created_at: datetime


class RecentUnhealthyStreamItem(BaseModel):
    """Latest problem signal per stream within the recent logs window."""

    stream_id: int
    stream_status: str
    last_problem_stage: str
    last_error_code: str | None = None
    last_error_message: str | None = None
    last_problem_at: datetime


class DashboardSummaryResponse(BaseModel):
    """GET /runtime/dashboard/summary response body."""

    summary: DashboardSummaryNumbers
    recent_problem_routes: list[RecentProblemRouteItem]
    recent_rate_limited_routes: list[RecentRateLimitedRouteItem]
    recent_unhealthy_streams: list[RecentUnhealthyStreamItem]


class RuntimeLogSearchFilters(BaseModel):
    """Echo of query filters used for GET /runtime/logs/search."""

    stream_id: int | None = None
    route_id: int | None = None
    destination_id: int | None = None
    stage: str | None = None
    level: str | None = None
    status: str | None = None
    error_code: str | None = None
    limit: int = 100


class RuntimeLogSearchItem(BaseModel):
    """delivery_logs row without payload_sample."""

    id: int
    connector_id: int | None = None
    stream_id: int | None = None
    route_id: int | None = None
    destination_id: int | None = None
    stage: str
    level: str
    status: str | None = None
    message: str
    retry_count: int = 0
    http_status: int | None = None
    latency_ms: int | None = None
    error_code: str | None = None
    created_at: datetime


class RuntimeLogSearchResponse(BaseModel):
    """GET /runtime/logs/search response body."""

    total_returned: int
    filters: RuntimeLogSearchFilters
    logs: list[RuntimeLogSearchItem]


class RuntimeLogsPageItem(BaseModel):
    """One delivery_logs row for cursor pagination (no payload_sample)."""

    id: int
    created_at: datetime
    connector_id: int | None = None
    stream_id: int | None = None
    route_id: int | None = None
    destination_id: int | None = None
    stage: str
    level: str
    status: str | None = None
    message: str
    error_code: str | None = None
    retry_count: int = 0
    http_status: int | None = None
    latency_ms: int | None = None


class RuntimeLogsPageResponse(BaseModel):
    """GET /runtime/logs/page response body."""

    total_returned: int
    has_next: bool
    next_cursor_created_at: datetime | None = None
    next_cursor_id: int | None = None
    items: list[RuntimeLogsPageItem]


class RuntimeTimelineItem(BaseModel):
    """One delivery_logs row for stream timeline (no payload_sample)."""

    id: int
    created_at: datetime
    stream_id: int | None = None
    route_id: int | None = None
    destination_id: int | None = None
    stage: str
    level: str
    status: str | None = None
    message: str
    error_code: str | None = None
    retry_count: int = 0
    http_status: int | None = None
    latency_ms: int | None = None


class RuntimeTimelineResponse(BaseModel):
    """GET /runtime/timeline/stream/{stream_id} response body."""

    stream_id: int
    total: int
    items: list[RuntimeTimelineItem]


class RuntimeFailureTrendBucket(BaseModel):
    """One aggregated bucket for failure / rate-limit delivery_logs (no payload_sample)."""

    stage: str
    count: int
    latest_created_at: datetime
    stream_id: int | None = None
    route_id: int | None = None
    destination_id: int | None = None
    error_code: str | None = None


class RuntimeFailureTrendResponse(BaseModel):
    """GET /runtime/failures/trend response body."""

    total: int
    buckets: list[RuntimeFailureTrendBucket]


class RuntimeStreamControlResponse(BaseModel):
    """POST /runtime/streams/{stream_id}/start|stop response body."""

    stream_id: int
    enabled: bool
    status: str
    action: str
    message: str


class RuntimeLogsCleanupRequest(BaseModel):
    """POST /runtime/logs/cleanup request body."""

    older_than_days: int = Field(..., ge=1, le=3650)
    dry_run: bool = True


class RuntimeLogsCleanupResponse(BaseModel):
    """POST /runtime/logs/cleanup response body."""

    older_than_days: int
    dry_run: bool
    cutoff: datetime
    matched_count: int
    deleted_count: int
    message: str


# --- Preview / API-test (no DB writes; kept alongside runtime read schemas)


class HttpApiTestRequest(BaseModel):
    source_config: dict[str, Any] = Field(default_factory=dict)
    stream_config: dict[str, Any] = Field(default_factory=dict)
    checkpoint: dict[str, Any] | None = None


class HttpApiTestResponse(BaseModel):
    raw_response: Any
    extracted_events: list[dict[str, Any]]
    event_count: int


class MappingPreviewRequest(BaseModel):
    raw_response: Any
    event_array_path: str | None = None
    field_mappings: dict[str, str] = Field(default_factory=dict)
    enrichment: dict[str, Any] = Field(default_factory=dict)
    override_policy: str = "KEEP_EXISTING"


class MappingPreviewResponse(BaseModel):
    input_event_count: int
    mapped_event_count: int
    preview_events: list[dict[str, Any]]


class FormatPreviewRequest(BaseModel):
    events: list[dict[str, Any]]
    destination_type: str
    formatter_config: dict[str, Any] = Field(default_factory=dict)


class FormatPreviewResponse(BaseModel):
    destination_type: str
    message_count: int
    preview_messages: list[Any]


class RouteDeliveryPreviewRequest(BaseModel):
    route_id: int
    events: list[dict[str, Any]]


class RouteDeliveryPreviewResponse(BaseModel):
    route_id: int
    destination_id: int
    destination_type: str
    route_enabled: bool
    destination_enabled: bool
    message_count: int
    resolved_formatter_config: dict[str, Any]
    preview_messages: list[Any]
