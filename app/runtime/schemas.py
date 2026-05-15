"""Pydantic schemas for runtime read-only APIs."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, StrictBool, field_validator, model_validator

from app.validation.schemas import ValidationOperationalSummaryResponse


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


class StreamRuntimeStatsHealthBundleResponse(BaseModel):
    """GET /runtime/streams/{stream_id}/stats-health — stats + health with one delivery_logs scan."""

    stats: StreamRuntimeStatsResponse
    health: StreamHealthResponse


class StreamMetricsCheckpoint(BaseModel):
    """Checkpoint block embedded in stream runtime metrics."""

    type: str
    value: dict[str, Any] = Field(default_factory=dict)


class StreamMetricsStreamBlock(BaseModel):
    """Stream identity + runtime timestamps for metrics panel."""

    id: int
    name: str
    status: str
    last_run_at: datetime | None = None
    last_success_at: datetime | None = None
    last_error_at: datetime | None = None
    last_checkpoint: StreamMetricsCheckpoint | None = None


class StreamRuntimeKpis(BaseModel):
    """Rolling KPI window (default: last 1 hour, aligned server-side)."""

    events_last_hour: int = 0
    delivered_last_hour: int = 0
    failed_last_hour: int = 0
    delivery_success_rate: float = 0.0
    avg_latency_ms: float = 0.0
    max_latency_ms: float = 0.0
    error_rate: float = 0.0


class StreamMetricsTimeBucket(BaseModel):
    """One time bucket for throughput visualization."""

    timestamp: datetime
    events: int = 0
    delivered: int = 0
    failed: int = 0


class ThroughputTimePoint(BaseModel):
    """Delivered throughput estimate per bucket."""

    timestamp: datetime
    events_per_sec: float = 0.0


class LatencyTimePoint(BaseModel):
    """Average delivery latency per bucket (successful sends only)."""

    timestamp: datetime
    avg_latency_ms: float = 0.0


class StreamMetricsRouteHealthRow(BaseModel):
    """Per-route delivery metrics for runtime dashboard."""

    route_id: int
    destination_name: str
    destination_type: str
    enabled: bool
    success_count: int = 0
    failed_count: int = 0
    last_success_at: datetime | None = None
    last_failure_at: datetime | None = None
    avg_latency_ms: float = 0.0
    failure_policy: str
    last_error_message: str | None = None


class StreamMetricsCheckpointHistoryItem(BaseModel):
    """Checkpoint history derived from checkpoints.updated_at (no separate audit table)."""

    updated_at: datetime
    checkpoint_preview: str


class StreamMetricsRecentRun(BaseModel):
    """One committed run_complete row (approximates a runner cycle)."""

    run_id: str
    started_at: datetime
    duration_ms: int = 0
    status: Literal["SUCCESS", "PARTIAL", "FAILED", "NO_EVENTS"]
    events: int = 0
    delivered: int = 0
    failed: int = 0


class RouteRuntimeLatencyTrendPoint(BaseModel):
    timestamp: datetime
    avg_latency_ms: float


class RouteRuntimeSuccessRateTrendPoint(BaseModel):
    timestamp: datetime
    success_rate: float


class RouteRuntimeMetricsRow(BaseModel):
    """Per-route operational metrics (1h window + trends + connectivity)."""

    route_id: int
    destination_id: int
    destination_name: str
    destination_type: str
    enabled: bool
    route_status: str
    success_rate: float
    events_last_hour: int
    delivered_last_hour: int
    failed_last_hour: int
    avg_latency_ms: float
    p95_latency_ms: float
    max_latency_ms: float
    eps_current: float
    retry_count_last_hour: int
    last_success_at: datetime | None = None
    last_failure_at: datetime | None = None
    last_error_message: str | None = None
    last_error_code: str | None = None
    failure_policy: str
    connectivity_state: Literal["HEALTHY", "DEGRADED", "ERROR", "DISABLED"]
    disable_reason: str | None = None
    latency_trend: list[RouteRuntimeLatencyTrendPoint]
    success_rate_trend: list[RouteRuntimeSuccessRateTrendPoint]


class RecentRouteErrorItem(BaseModel):
    """One recent committed route-scoped failure row for the operational panel."""

    created_at: datetime
    route_id: int
    destination_id: int | None = None
    destination_name: str
    error_code: str | None = None
    message: str


class StreamRuntimeMetricsResponse(BaseModel):
    """GET /runtime/streams/{stream_id}/metrics — Datadog-style runtime metrics."""

    stream: StreamMetricsStreamBlock
    kpis: StreamRuntimeKpis
    metrics_window_seconds: int = 3600
    events_over_time: list[StreamMetricsTimeBucket]
    throughput_over_time: list[ThroughputTimePoint] = Field(default_factory=list)
    latency_over_time: list[LatencyTimePoint] = Field(default_factory=list)
    route_health: list[StreamMetricsRouteHealthRow]
    checkpoint_history: list[StreamMetricsCheckpointHistoryItem]
    recent_runs: list[StreamMetricsRecentRun]
    route_runtime: list[RouteRuntimeMetricsRow] = Field(default_factory=list)
    recent_route_errors: list[RecentRouteErrorItem] = Field(default_factory=list)


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
    scheduler_started_at: datetime | None = None
    scheduler_uptime_seconds: float | None = None
    runtime_engine_status: Literal["RUNNING", "STOPPED", "DEGRADED"] = "STOPPED"
    active_worker_count: int | None = None
    metrics_window_seconds: int = 3600
    validation_operational: ValidationOperationalSummaryResponse | None = None


class DashboardOutcomeBucket(BaseModel):
    """One aligned bucket for cross-stream success / failed / rate-limited counts."""

    bucket_start: datetime
    success: int = 0
    failed: int = 0
    rate_limited: int = 0


class DashboardOutcomeTimeseriesResponse(BaseModel):
    """GET /runtime/dashboard/outcome-timeseries response body (read-only)."""

    metrics_window_seconds: int
    buckets: list[DashboardOutcomeBucket] = Field(default_factory=list)


class RuntimeAlertSummaryItem(BaseModel):
    """One grouped WARN/ERROR summary row."""

    stream_id: int
    stream_name: str
    connector_name: str
    severity: Literal["WARN", "ERROR"]
    count: int
    latest_occurrence: datetime


class RuntimeAlertSummaryResponse(BaseModel):
    """GET /runtime/logs/alerts/summary — grouped delivery_logs WARN/ERROR totals."""

    metrics_window_seconds: int
    items: list[RuntimeAlertSummaryItem]


class RuntimeSystemResourcesResponse(BaseModel):
    """GET /runtime/system/resources — local host metrics."""

    cpu_percent: float
    memory_percent: float
    memory_used_bytes: int
    memory_total_bytes: int
    disk_percent: float
    disk_used_bytes: int
    disk_total_bytes: int
    network_in_bytes_per_sec: float
    network_out_bytes_per_sec: float


class RuntimeLogSearchFilters(BaseModel):
    """Echo of query filters used for GET /runtime/logs/search."""

    stream_id: int | None = None
    route_id: int | None = None
    destination_id: int | None = None
    run_id: str | None = None
    stage: str | None = None
    level: str | None = None
    status: str | None = None
    error_code: str | None = None
    partial_success: bool | None = None
    limit: int = 100
    metrics_window_seconds: int | None = None
    window_start_at: datetime | None = None


class RuntimeLogSearchItem(BaseModel):
    """delivery_logs row without payload_sample."""

    id: int
    connector_id: int | None = None
    stream_id: int | None = None
    route_id: int | None = None
    destination_id: int | None = None
    run_id: str | None = None
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
    run_id: str | None = None
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


class RuntimeTraceConnectorRef(BaseModel):
    id: int
    name: str


class RuntimeTraceStreamRef(BaseModel):
    id: int
    name: str


class RuntimeTraceRouteRef(BaseModel):
    id: int
    destination_id: int | None = None
    label: str


class RuntimeTraceDestinationRef(BaseModel):
    id: int
    name: str


class RuntimeTraceCheckpointEvent(BaseModel):
    checkpoint_type: str | None = None
    message: str | None = None
    checkpoint_before: dict[str, Any] | None = None
    checkpoint_after: dict[str, Any] | None = None
    processed_events: int | None = None
    delivered_events: int | None = None
    failed_events: int | None = None
    partial_success: bool | None = None
    update_reason: str | None = None
    correlated_route_failures: list[dict[str, Any]] = Field(default_factory=list)


class CheckpointTraceRouteFailureRef(BaseModel):
    """Route-level delivery failure correlated with a checkpoint trace."""

    route_id: int
    destination_id: int | None = None
    stage: str
    message: str
    error_code: str | None = None
    created_at: datetime


class CheckpointTraceTimelineNode(BaseModel):
    """Compact operational timeline entry for checkpoint debugging."""

    kind: str
    title: str
    detail: str | None = None
    tone: Literal["success", "warning", "error", "neutral"] = "neutral"
    created_at: datetime | None = None
    log_id: int | None = None


class CheckpointTraceResponse(BaseModel):
    """Checkpoint trace for one StreamRunner execution (run_id)."""

    run_id: str
    stream_id: int | None = None
    stream_name: str | None = None
    connector_name: str | None = None
    checkpoint_type: str | None = None
    checkpoint_before: dict[str, Any] | None = None
    checkpoint_after: dict[str, Any] | None = None
    processed_events: int | None = None
    delivered_events: int | None = None
    failed_events: int | None = None
    partial_success: bool | None = None
    update_reason: str | None = None
    retry_pending: bool | None = None
    correlated_route_failures: list[CheckpointTraceRouteFailureRef] = Field(default_factory=list)
    timeline_events: list[CheckpointTraceTimelineNode] = Field(default_factory=list)


class CheckpointHistoryItem(BaseModel):
    """One checkpoint_update row summary for stream history."""

    log_id: int
    run_id: str | None = None
    created_at: datetime
    checkpoint_type: str | None = None
    update_reason: str | None = None
    partial_success: bool | None = None
    checkpoint_after_preview: str | None = None


class CheckpointHistoryResponse(BaseModel):
    """GET /runtime/checkpoints/streams/{stream_id}/history"""

    stream_id: int
    items: list[CheckpointHistoryItem]


class RuntimeTraceTimelineEntry(BaseModel):
    id: int
    created_at: datetime
    stage: str
    level: str
    status: str | None = None
    message: str
    route_id: int | None = None
    destination_id: int | None = None
    latency_ms: int | None = None
    retry_count: int = 0
    http_status: int | None = None
    error_code: str | None = None


class RuntimeTraceResponse(BaseModel):
    """GET /runtime/logs/{id}/trace or GET /runtime/runs/{run_id}/trace."""

    run_id: str | None = None
    anchor_log_id: int | None = None
    stream_id: int | None = None
    connector: RuntimeTraceConnectorRef | None = None
    stream: RuntimeTraceStreamRef | None = None
    routes: list[RuntimeTraceRouteRef] = Field(default_factory=list)
    destinations: list[RuntimeTraceDestinationRef] = Field(default_factory=list)
    timeline: list[RuntimeTraceTimelineEntry]
    checkpoint: RuntimeTraceCheckpointEvent | None = None


class RuntimeTimelineItem(BaseModel):
    """One delivery_logs row for stream timeline (no payload_sample)."""

    id: int
    created_at: datetime
    stream_id: int | None = None
    route_id: int | None = None
    destination_id: int | None = None
    run_id: str | None = None
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


class RuntimeStreamRunOnceResponse(BaseModel):
    """POST /runtime/streams/{stream_id}/run-once — single StreamRunner cycle with DB commit."""

    stream_id: int
    outcome: Literal["completed", "skipped_lock", "no_events"]
    message: str | None = None
    extracted_event_count: int | None = None
    mapped_event_count: int | None = None
    enriched_event_count: int | None = None
    delivered_batch_event_count: int | None = None
    checkpoint_updated: bool = False
    transaction_committed: bool = False


class MappingUIConfigMapping(BaseModel):
    exists: bool
    event_array_path: str | None
    event_root_path: str | None
    field_mappings: dict[str, str]
    raw_payload_mode: str | None


class MappingUIConfigEnrichment(BaseModel):
    exists: bool
    enabled: bool
    enrichment: dict[str, Any]
    override_policy: str | None


class MappingUIConfigRouteItem(BaseModel):
    route_id: int
    destination_id: int
    destination_name: str | None
    destination_type: str | None
    route_enabled: bool
    destination_enabled: bool
    formatter_config: dict[str, Any]
    route_rate_limit: dict[str, Any]
    failure_policy: str


class MappingUIConfigResponse(BaseModel):
    stream_id: int
    stream_name: str
    stream_enabled: bool
    stream_status: str
    source_id: int
    source_type: str
    source_config: dict[str, Any]
    mapping: MappingUIConfigMapping
    enrichment: MappingUIConfigEnrichment
    routes: list[MappingUIConfigRouteItem]
    message: str


class MappingUISaveMappingPayload(BaseModel):
    event_array_path: str | None = None
    event_root_path: str | None = None
    field_mappings: dict[str, str]
    raw_payload_mode: str | None = None

    @field_validator("field_mappings")
    @classmethod
    def field_mappings_non_empty(cls, v: dict[str, str]) -> dict[str, str]:
        if not v:
            raise ValueError("field_mappings must contain at least one entry")
        return v


class MappingUISaveEnrichmentPayload(BaseModel):
    enabled: bool = True
    enrichment: dict[str, Any] = Field(default_factory=dict)
    override_policy: Literal["KEEP_EXISTING", "OVERRIDE", "ERROR_ON_CONFLICT"] = "KEEP_EXISTING"


class MappingUISaveRouteFormatterPayload(BaseModel):
    route_id: int
    formatter_config: dict[str, Any]

    @field_validator("formatter_config")
    @classmethod
    def formatter_config_non_empty(cls, v: dict[str, Any]) -> dict[str, Any]:
        if not v:
            raise ValueError("formatter_config must contain at least one entry")
        return v


class MappingUISaveRequest(BaseModel):
    mapping: MappingUISaveMappingPayload | None = None
    enrichment: MappingUISaveEnrichmentPayload | None = None
    route_formatters: list[MappingUISaveRouteFormatterPayload] = Field(default_factory=list)


class MappingUISaveResponse(BaseModel):
    stream_id: int
    mapping_saved: bool
    enrichment_saved: bool
    route_formatter_saved_count: int
    route_formatter_route_ids: list[int]
    message: str


class RouteUIConfigRoute(BaseModel):
    id: int
    stream_id: int
    destination_id: int
    enabled: bool
    failure_policy: str
    formatter_config_json: dict[str, Any]
    rate_limit_json: dict[str, Any]


class RouteUIConfigDestination(BaseModel):
    id: int | None
    name: str | None
    destination_type: str | None
    enabled: bool
    config_json: dict[str, Any]
    rate_limit_json: dict[str, Any]


class RouteUIConfigResponse(BaseModel):
    route: RouteUIConfigRoute
    destination: RouteUIConfigDestination
    effective_formatter_config: dict[str, Any]
    effective_rate_limit: dict[str, Any]
    message: str


class RouteUISaveRequest(BaseModel):
    route_enabled: bool | None = None
    route_formatter_config: dict[str, Any] | None = None
    route_rate_limit: dict[str, Any] | None = None
    failure_policy: Literal[
        "LOG_AND_CONTINUE",
        "PAUSE_STREAM_ON_FAILURE",
        "RETRY_AND_BACKOFF",
        "DISABLE_ROUTE_ON_FAILURE",
    ] | None = None
    destination_enabled: bool | None = None

    @field_validator("route_formatter_config")
    @classmethod
    def route_formatter_config_non_empty(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v is not None and not v:
            raise ValueError("route_formatter_config must contain at least one entry")
        return v

    @field_validator("route_rate_limit")
    @classmethod
    def route_rate_limit_non_empty(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v is not None and not v:
            raise ValueError("route_rate_limit must contain at least one entry")
        return v


class RouteUISaveResponse(BaseModel):
    route_id: int
    destination_id: int
    route_enabled: bool
    destination_enabled: bool
    failure_policy: str
    formatter_config: dict[str, Any]
    route_rate_limit: dict[str, Any]
    message: str


class DestinationUIConfigDestination(BaseModel):
    id: int
    name: str
    destination_type: str
    enabled: bool
    config_json: dict[str, Any]
    rate_limit_json: dict[str, Any]


class DestinationUIConfigRouteItem(BaseModel):
    id: int
    stream_id: int
    stream_name: str | None
    enabled: bool
    failure_policy: str
    formatter_config_json: dict[str, Any]
    rate_limit_json: dict[str, Any]


class DestinationUIConfigResponse(BaseModel):
    destination: DestinationUIConfigDestination
    routes: list[DestinationUIConfigRouteItem]
    message: str


class DestinationUISaveRequest(BaseModel):
    name: str
    enabled: bool
    config_json: dict[str, Any]
    rate_limit_json: dict[str, Any]


class DestinationUISaveResponse(BaseModel):
    destination_id: int
    name: str
    enabled: bool
    config_json: dict[str, Any]
    rate_limit_json: dict[str, Any]
    message: str


class StreamUIConfigStream(BaseModel):
    id: int
    connector_id: int
    source_id: int
    name: str
    stream_type: str
    enabled: bool
    status: str
    polling_interval: int
    config_json: dict[str, Any]
    rate_limit_json: dict[str, Any]


class StreamUIConfigSourceSummary(BaseModel):
    id: int | None
    source_type: str | None
    enabled: bool
    config_json: dict[str, Any]


class StreamUIConfigMappingSummary(BaseModel):
    exists: bool
    event_array_path: str | None
    event_root_path: str | None
    raw_payload_mode: str | None


class StreamUIConfigEnrichmentSummary(BaseModel):
    exists: bool
    enabled: bool
    override_policy: str | None


class StreamUIConfigRouteSummary(BaseModel):
    id: int
    destination_id: int
    destination_name: str | None
    destination_type: str | None
    enabled: bool
    destination_enabled: bool
    failure_policy: str


class StreamUIConfigResponse(BaseModel):
    stream: StreamUIConfigStream
    source: StreamUIConfigSourceSummary
    mapping: StreamUIConfigMappingSummary
    enrichment: StreamUIConfigEnrichmentSummary
    routes: list[StreamUIConfigRouteSummary]
    message: str


class StreamUISaveRequest(BaseModel):
    name: str
    enabled: bool
    polling_interval: int
    config_json: dict[str, Any]
    rate_limit_json: dict[str, Any]


class StreamUISaveResponse(BaseModel):
    stream_id: int
    name: str
    enabled: bool
    polling_interval: int
    config_json: dict[str, Any]
    rate_limit_json: dict[str, Any]
    message: str


class SourceUIConfigSource(BaseModel):
    id: int
    connector_id: int
    source_type: str
    enabled: bool
    config_json: dict[str, Any]
    auth_json: dict[str, Any]


class SourceUIConfigStreamItem(BaseModel):
    id: int
    name: str
    stream_type: str
    enabled: bool
    status: str
    polling_interval: int
    config_json: dict[str, Any]
    rate_limit_json: dict[str, Any]
    route_count: int


class SourceUIConfigResponse(BaseModel):
    source: SourceUIConfigSource
    streams: list[SourceUIConfigStreamItem]
    message: str


class SourceUISaveRequest(BaseModel):
    enabled: bool
    config_json: dict[str, Any]
    auth_json: dict[str, Any]
    source_type: str | None = Field(
        default=None,
        description="When set, updates Source.source_type (e.g. S3_OBJECT_POLLING).",
    )


class SourceUISaveResponse(BaseModel):
    source_id: int
    enabled: bool
    config_json: dict[str, Any]
    auth_json: dict[str, Any]
    message: str


class ConnectorUIConfigConnector(BaseModel):
    id: int
    name: str
    description: str | None
    status: str


class ConnectorUIConfigSourceSummary(BaseModel):
    id: int
    source_type: str
    enabled: bool
    stream_count: int


class ConnectorUIConfigStreamSummary(BaseModel):
    id: int
    source_id: int
    name: str
    stream_type: str
    enabled: bool
    status: str
    polling_interval: int
    route_count: int


class ConnectorUIConfigSummary(BaseModel):
    source_count: int
    stream_count: int
    enabled_stream_count: int
    route_count: int


class ConnectorUIConfigResponse(BaseModel):
    connector: ConnectorUIConfigConnector
    sources: list[ConnectorUIConfigSourceSummary]
    streams: list[ConnectorUIConfigStreamSummary]
    summary: ConnectorUIConfigSummary
    message: str


class ConnectorUISaveRequest(BaseModel):
    name: str
    description: str | None = None
    status: str


class ConnectorUISaveResponse(BaseModel):
    connector_id: int
    name: str
    description: str | None
    status: str
    message: str


class RuntimeMappingSaveRequest(BaseModel):
    """POST /runtime/mappings/stream/{stream_id}/save request body."""

    event_array_path: str | None = None
    event_root_path: str | None = None
    field_mappings: dict[str, str]

    @field_validator("field_mappings")
    @classmethod
    def field_mappings_non_empty(cls, v: dict[str, str]) -> dict[str, str]:
        if not v:
            raise ValueError("field_mappings must contain at least one entry")
        return v


class RuntimeMappingSaveResponse(BaseModel):
    """POST /runtime/mappings/stream/{stream_id}/save response body."""

    stream_id: int
    mapping_id: int
    event_array_path: str | None
    event_root_path: str | None
    field_count: int
    message: str


RuntimeEnrichmentOverridePolicy = Literal["fill_missing", "override"]


class RuntimeEnrichmentSaveRequest(BaseModel):
    """POST /runtime/enrichments/stream/{stream_id}/save request body."""

    enrichment: dict[str, Any]
    override_policy: RuntimeEnrichmentOverridePolicy = "fill_missing"
    enabled: bool = True

    @field_validator("enrichment")
    @classmethod
    def enrichment_non_empty(cls, v: dict[str, Any]) -> dict[str, Any]:
        if not v:
            raise ValueError("enrichment must contain at least one entry")
        return v


class RuntimeEnrichmentSaveResponse(BaseModel):
    """POST /runtime/enrichments/stream/{stream_id}/save response body."""

    stream_id: int
    enrichment_id: int
    field_count: int
    override_policy: str
    enabled: bool
    message: str


class RuntimeRouteFormatterSaveRequest(BaseModel):
    """POST /runtime/routes/{route_id}/formatter/save request body."""

    formatter_config: dict[str, Any]

    @field_validator("formatter_config")
    @classmethod
    def formatter_config_non_empty(cls, v: dict[str, Any]) -> dict[str, Any]:
        if not v:
            raise ValueError("formatter_config must contain at least one entry")
        return v


class RuntimeRouteFormatterSaveResponse(BaseModel):
    """POST /runtime/routes/{route_id}/formatter/save response body."""

    route_id: int
    stream_id: int
    destination_id: int
    formatter_config: dict[str, Any]
    field_count: int
    message: str


class RuntimeRouteFailurePolicySaveRequest(BaseModel):
    """POST /runtime/routes/{route_id}/failure-policy/save request body."""

    failure_policy: Literal[
        "LOG_AND_CONTINUE",
        "PAUSE_STREAM_ON_FAILURE",
        "RETRY_AND_BACKOFF",
        "DISABLE_ROUTE_ON_FAILURE",
    ]


class RuntimeRouteFailurePolicySaveResponse(BaseModel):
    """POST /runtime/routes/{route_id}/failure-policy/save response body."""

    route_id: int
    stream_id: int
    destination_id: int
    failure_policy: str
    message: str


class RuntimeRouteEnabledSaveRequest(BaseModel):
    """POST /runtime/routes/{route_id}/enabled/save request body."""

    enabled: StrictBool
    disable_reason: str | None = None


class RuntimeRouteEnabledSaveResponse(BaseModel):
    """POST /runtime/routes/{route_id}/enabled/save response body."""

    route_id: int
    stream_id: int
    destination_id: int
    enabled: bool
    message: str


class RuntimeRouteRateLimitSaveRequest(BaseModel):
    """POST /runtime/routes/{route_id}/rate-limit/save request body."""

    rate_limit: dict[str, Any]

    @field_validator("rate_limit")
    @classmethod
    def rate_limit_non_empty(cls, v: dict[str, Any]) -> dict[str, Any]:
        if not v:
            raise ValueError("rate_limit must contain at least one entry")
        return v


class RuntimeRouteRateLimitSaveResponse(BaseModel):
    """POST /runtime/routes/{route_id}/rate-limit/save response body."""

    route_id: int
    stream_id: int
    destination_id: int
    rate_limit: dict[str, Any]
    field_count: int
    message: str


class RuntimeStreamRateLimitSaveRequest(BaseModel):
    """POST /runtime/streams/{stream_id}/rate-limit/save request body."""

    rate_limit: dict[str, Any]

    @field_validator("rate_limit")
    @classmethod
    def rate_limit_non_empty(cls, v: dict[str, Any]) -> dict[str, Any]:
        if not v:
            raise ValueError("rate_limit must contain at least one entry")
        return v


class RuntimeStreamRateLimitSaveResponse(BaseModel):
    """POST /runtime/streams/{stream_id}/rate-limit/save response body."""

    stream_id: int
    connector_id: int
    source_id: int
    rate_limit: dict[str, Any]
    field_count: int
    message: str


class RuntimeDestinationRateLimitSaveRequest(BaseModel):
    """POST /runtime/destinations/{destination_id}/rate-limit/save request body."""

    rate_limit: dict[str, Any]

    @field_validator("rate_limit")
    @classmethod
    def rate_limit_non_empty(cls, v: dict[str, Any]) -> dict[str, Any]:
        if not v:
            raise ValueError("rate_limit must contain at least one entry")
        return v


class RuntimeDestinationRateLimitSaveResponse(BaseModel):
    """POST /runtime/destinations/{destination_id}/rate-limit/save response body."""

    destination_id: int
    destination_type: str
    rate_limit: dict[str, Any]
    field_count: int
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
    connector_id: int | None = Field(
        default=None,
        description="Load base URL, shared headers, proxy, TLS, and auth secrets from this connector's Source row.",
    )
    fetch_sample: bool = Field(
        default=False,
        description="Reserved for sample-fetch UX; request URL and query params match stream_config as normalized (no automatic limit injection).",
    )


class ConnectorAuthTestRequest(BaseModel):
    connector_id: int | None = Field(
        default=None,
        ge=1,
        description="Saved Generic HTTP connector Source row. Omit when sending inline_flat_source.",
    )
    inline_flat_source: dict[str, Any] | None = Field(
        default=None,
        description="Unsaved connector: flattened Source config+auth (base_url, verify_ssl, http_proxy, headers, auth_type, secrets…).",
    )
    method: str = Field(default="GET", description="HTTP method for the auth probe request.")
    test_path: str | None = Field(
        default=None,
        description="Path relative to connector base_url (e.g. /api/v1/alerts). Ignored when test_url is set.",
    )
    test_url: str | None = Field(
        default=None,
        description="Optional absolute URL; must use the same host as the connector base_url (SSRF guard).",
    )
    extra_headers: dict[str, str] = Field(default_factory=dict, description="Additional request headers merged after connector common headers.")
    query_params: dict[str, Any] = Field(default_factory=dict, description="Query parameters for the probe request.")
    json_body: Any | None = Field(default=None, description="JSON body for POST/PUT/PATCH/DELETE.")
    remote_file_stream_config: dict[str, Any] | None = Field(
        default=None,
        description="REMOTE_FILE_POLLING probe: remote_directory, file_pattern, recursive (connector-auth test).",
    )

    @model_validator(mode="after")
    def _connector_id_xor_inline(self) -> ConnectorAuthTestRequest:
        has_id = self.connector_id is not None
        inl = self.inline_flat_source
        has_inline_http = isinstance(inl, dict) and str(inl.get("base_url") or "").strip() != ""
        has_inline_s3 = (
            isinstance(inl, dict)
            and str(inl.get("endpoint_url") or "").strip() != ""
            and str(inl.get("bucket") or "").strip() != ""
        )
        has_inline_db = (
            isinstance(inl, dict)
            and str(inl.get("source_type") or "").strip().upper() == "DATABASE_QUERY"
            and str(inl.get("host") or "").strip() != ""
            and str(inl.get("database") or "").strip() != ""
        )
        has_inline_rf = isinstance(inl, dict) and str(inl.get("host") or "").strip() != "" and (
            str(inl.get("source_type") or "").strip().upper() == "REMOTE_FILE_POLLING"
            or str(inl.get("connector_type") or "").strip().lower() == "remote_file"
        )
        has_inline = has_inline_http or has_inline_s3 or has_inline_db or has_inline_rf
        if has_id and has_inline:
            raise ValueError("Specify only one of connector_id or inline_flat_source")
        if not has_id and not has_inline:
            raise ValueError(
                "connector_id or inline_flat_source with base_url (HTTP), endpoint_url+bucket (S3), "
                "DATABASE_QUERY (host+database+db_type), or REMOTE_FILE_POLLING (host) is required"
            )
        return self


class ConnectorAuthTestResponse(BaseModel):
    ok: bool
    auth_type: str = Field(description="Normalized uppercase auth type from connector Source.")
    message: str | None = None
    error_type: str | None = None
    phase: str | None = Field(
        default=None,
        description="vendor_jwt_exchange: token_exchange | final_request on failure; omitted when ok.",
    )
    login_http_status: int | None = None
    login_final_url: str | None = None
    redirect_chain: list[str] = Field(default_factory=list)
    session_login_body_mode: str | None = None
    session_login_follow_redirects: bool | None = None
    login_failure_reason: str | None = None
    login_http_reason: str | None = None
    session_login_body_preview: str | None = Field(
        default=None,
        description="Masked preview of the login request body (session_login diagnostic).",
    )
    session_login_content_type: str | None = Field(
        default=None,
        description="Resolved Content-Type header on the login request.",
    )
    session_login_request_encoding: str | None = Field(
        default=None,
        description="httpx encoding: json | data | content | none.",
    )
    preflight_http_status: int | None = None
    preflight_final_url: str | None = None
    preflight_cookies: dict[str, str] | None = None
    extracted_variables: dict[str, str] | None = None
    template_render_preview: str | None = None
    computed_login_request_url: str | None = None
    login_url_resolution_warnings: list[str] = Field(default_factory=list)
    session_cookie_obtained: bool = False
    cookie_names: list[str] = Field(default_factory=list)
    probe_http_status: int | None = None
    probe_url: str | None = None
    request_method: str | None = None
    request_url: str | None = None
    request_headers_masked: dict[str, str] = Field(default_factory=dict)
    response_status_code: int | None = None
    response_headers_masked: dict[str, str] = Field(default_factory=dict)
    response_body: str | None = None
    token_request_method: str | None = None
    token_request_url: str | None = None
    token_request_headers_masked: dict[str, str] = Field(default_factory=dict)
    token_request_body_mode: str | None = Field(
        default=None,
        description="vendor_jwt token exchange body mode (e.g. empty, json, form).",
    )
    token_response_status_code: int | None = None
    token_response_headers_masked: dict[str, str] = Field(default_factory=dict)
    token_response_body: str | None = None
    token_response_body_masked: str | None = None
    final_request_method: str | None = None
    final_request_url: str | None = None
    final_request_headers_masked: dict[str, str] = Field(default_factory=dict)
    final_response_status_code: int | None = None
    final_response_headers_masked: dict[str, str] = Field(default_factory=dict)
    final_response_body: str | None = None
    s3_endpoint_reachable: bool | None = Field(default=None, description="S3 probe: TCP/client to endpoint.")
    s3_auth_ok: bool | None = Field(default=None, description="S3 probe: credentials accepted for HeadBucket.")
    s3_bucket_exists: bool | None = Field(default=None, description="S3 probe: HeadBucket succeeded.")
    s3_object_count_preview: int | None = Field(default=None, description="S3 probe: object count under prefix (capped).")
    s3_sample_keys: list[str] | None = Field(default=None, description="S3 probe: first object keys (no URLs).")
    db_reachable: bool | None = Field(default=None, description="DATABASE_QUERY probe: TCP/connect reached server.")
    db_auth_ok: bool | None = Field(default=None, description="DATABASE_QUERY probe: credentials accepted.")
    db_select_ok: bool | None = Field(default=None, description="DATABASE_QUERY probe: SELECT 1 succeeded.")
    ssh_reachable: bool | None = Field(default=None, description="REMOTE_FILE_POLLING probe: TCP/SSH reached host.")
    ssh_auth_ok: bool | None = Field(default=None, description="REMOTE_FILE_POLLING probe: SSH authentication succeeded.")
    sftp_available: bool | None = Field(default=None, description="REMOTE_FILE_POLLING probe: SFTP subsystem available.")
    remote_directory_accessible: bool | None = Field(
        default=None, description="REMOTE_FILE_POLLING probe: remote_directory is listable."
    )
    matched_file_count: int | None = Field(default=None, description="REMOTE_FILE_POLLING probe: files matching pattern.")
    sample_remote_paths: list[str] | None = Field(default=None, description="REMOTE_FILE_POLLING probe: sample paths.")
    host_key_status: str | None = Field(default=None, description="REMOTE_FILE_POLLING probe: host-key policy label.")


class HttpApiTestRequestMeta(BaseModel):
    method: str
    url: str
    headers_masked: dict[str, str] = Field(default_factory=dict)


class HttpApiTestActualRequestMeta(BaseModel):
    method: str
    url: str
    endpoint: str | None = None
    query_params: dict[str, Any] = Field(default_factory=dict)
    headers_masked: dict[str, str] = Field(default_factory=dict)
    json_body_masked: Any | None = None
    timeout_seconds: float


class HttpApiTestStep(BaseModel):
    name: str
    success: bool
    status_code: int | None = None
    message: str = ""


class ApiTestResponseSummary(BaseModel):
    root_type: str
    approx_size_bytes: int = 0
    top_level_keys: list[str] = Field(default_factory=list)
    item_count_root: int | None = None
    truncation: str | None = None


class DetectedArrayCandidate(BaseModel):
    path: str
    count: int
    confidence: float = Field(..., ge=0.0, le=1.0)
    reason: str
    sample_item_preview: Any | None = None


class DetectedCheckpointCandidate(BaseModel):
    field_path: str
    checkpoint_type: Literal["TIMESTAMP", "EVENT_ID", "CURSOR", "OFFSET"]
    confidence: float = Field(..., ge=0.0, le=1.0)
    sample_value: Any | None = None
    reason: str = ""


class HttpApiTestAnalysis(BaseModel):
    response_summary: ApiTestResponseSummary
    detected_arrays: list[DetectedArrayCandidate] = Field(default_factory=list)
    detected_checkpoint_candidates: list[DetectedCheckpointCandidate] = Field(default_factory=list)
    sample_event: Any | None = None
    selected_event_array_default: str | None = None
    flat_preview_fields: list[str] = Field(default_factory=list)
    preview_error: str | None = None


class HttpApiTestResponseMeta(BaseModel):
    status_code: int
    latency_ms: int
    headers: dict[str, str] = Field(default_factory=dict)
    raw_body: str
    parsed_json: Any | None = None
    content_type: str | None = None


class HttpApiTestResponse(BaseModel):
    ok: bool
    request: HttpApiTestRequestMeta
    actual_request_sent: HttpApiTestActualRequestMeta | None = None
    response: HttpApiTestResponseMeta | None = None
    error_type: str | None = None
    message: str | None = None
    target_status_code: int | None = None
    target_response_body: str | None = None
    hint: str | None = None
    error_code: str | None = None
    steps: list[HttpApiTestStep] = Field(default_factory=list)
    response_sample: Any | None = None
    analysis: HttpApiTestAnalysis | None = None
    database_query_row_count: int | None = Field(default=None, description="Row count from DATABASE_QUERY sample fetch.")
    database_query_sample_rows: list[dict[str, Any]] | None = Field(
        default=None,
        description="First rows from DATABASE_QUERY sample (capped); never includes passwords.",
    )
    remote_file_event_count: int | None = Field(
        default=None, description="REMOTE_FILE_POLLING sample fetch: extracted event count (capped)."
    )


class MappingPreviewRequest(BaseModel):
    raw_response: Any
    event_array_path: str | None = None
    event_root_path: str | None = None
    field_mappings: dict[str, str] = Field(default_factory=dict)
    enrichment: dict[str, Any] = Field(default_factory=dict)
    override_policy: str = "KEEP_EXISTING"


class MappingPreviewResponse(BaseModel):
    input_event_count: int
    mapped_event_count: int
    preview_events: list[dict[str, Any]]


class MappingDraftPreviewRequest(BaseModel):
    payload: dict[str, Any] | list[Any]
    event_array_path: str | None = None
    event_root_path: str | None = None
    field_mappings: dict[str, str] = Field(default_factory=dict)
    max_events: int = Field(default=5, ge=1, le=100)


class MappingDraftPreviewMissingFieldItem(BaseModel):
    output_field: str
    json_path: str
    event_index: int


class MappingDraftPreviewResponse(BaseModel):
    input_event_count: int
    preview_event_count: int
    mapped_events: list[dict[str, Any]]
    missing_fields: list[MappingDraftPreviewMissingFieldItem]
    message: str


class FinalEventDraftPreviewRequest(BaseModel):
    payload: dict[str, Any] | list[Any]
    event_array_path: str | None = None
    event_root_path: str | None = None
    field_mappings: dict[str, str] = Field(default_factory=dict)
    enrichment: dict[str, Any] = Field(default_factory=dict)
    override_policy: Literal["KEEP_EXISTING", "OVERRIDE", "ERROR_ON_CONFLICT"] = "KEEP_EXISTING"
    max_events: int = Field(default=5, ge=1, le=100)


class FinalEventDraftPreviewResponse(BaseModel):
    input_event_count: int
    preview_event_count: int
    mapped_events: list[dict[str, Any]]
    final_events: list[dict[str, Any]]
    missing_fields: list[MappingDraftPreviewMissingFieldItem]
    message: str


class DeliveryFormatDraftPreviewRequest(BaseModel):
    final_events: list[dict[str, Any]]
    destination_type: Literal["SYSLOG_UDP", "SYSLOG_TCP", "SYSLOG_TLS", "WEBHOOK_POST"]
    formatter_config: dict[str, Any] = Field(default_factory=dict)
    max_events: int = Field(default=5, ge=1, le=100)
    payload_mode: Literal["SINGLE_EVENT_OBJECT", "BATCH_JSON_ARRAY"] | None = None
    webhook_batch_size: int | None = Field(default=None, ge=1, le=10_000)


class DeliveryFormatDraftPreviewResponse(BaseModel):
    input_event_count: int
    preview_event_count: int
    destination_type: str
    preview_messages: list[Any]
    message: str


class E2EDraftPreviewRequest(BaseModel):
    payload: dict[str, Any] | list[Any]
    event_array_path: str | None = None
    event_root_path: str | None = None
    field_mappings: dict[str, str] = Field(default_factory=dict)
    enrichment: dict[str, Any] = Field(default_factory=dict)
    override_policy: Literal["KEEP_EXISTING", "OVERRIDE", "ERROR_ON_CONFLICT"] = "KEEP_EXISTING"
    destination_type: Literal["SYSLOG_UDP", "SYSLOG_TCP", "SYSLOG_TLS", "WEBHOOK_POST"]
    formatter_config: dict[str, Any] = Field(default_factory=dict)
    max_events: int = Field(default=5, ge=1, le=100)
    payload_mode: Literal["SINGLE_EVENT_OBJECT", "BATCH_JSON_ARRAY"] | None = None
    webhook_batch_size: int | None = Field(default=None, ge=1, le=10_000)


class E2EDraftPreviewResponse(BaseModel):
    input_event_count: int
    preview_event_count: int
    mapped_events: list[dict[str, Any]]
    final_events: list[dict[str, Any]]
    preview_messages: list[Any]
    missing_fields: list[MappingDraftPreviewMissingFieldItem]
    destination_type: str
    message: str


class FormatPreviewRequest(BaseModel):
    events: list[dict[str, Any]]
    destination_type: str
    formatter_config: dict[str, Any] = Field(default_factory=dict)
    payload_mode: Literal["SINGLE_EVENT_OBJECT", "BATCH_JSON_ARRAY"] | None = None
    webhook_batch_size: int | None = Field(default=None, ge=1, le=10_000)


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


class DeliveryPrefixFormatPreviewRequest(BaseModel):
    """POST /runtime/format-preview — prefix resolution + final wire payload for UI."""

    formatter_config: dict[str, Any] = Field(default_factory=dict)
    sample_event: dict[str, Any] = Field(default_factory=dict)
    destination_type: str
    stream: dict[str, Any] = Field(default_factory=dict)
    destination: dict[str, Any] = Field(default_factory=dict)
    route: dict[str, Any] = Field(default_factory=dict)
    payload_mode: Literal["SINGLE_EVENT_OBJECT", "BATCH_JSON_ARRAY"] | None = None


class DeliveryPrefixFormatPreviewResponse(BaseModel):
    resolved_prefix: str
    final_payload: str
    message_prefix_enabled: bool


class MappingJsonPathsRequest(BaseModel):
    """POST /runtime/preview/json-paths request body (Mapping UI JSONPath discovery)."""

    payload: dict[str, Any] | list[Any]
    max_depth: int | None = Field(default=8, ge=1, le=20)
    max_paths: int | None = Field(default=500, ge=1, le=5000)
    scalars_only: bool = True


class MappingJsonPathItem(BaseModel):
    """One scalar JSONPath candidate for Mapping UI."""

    path: str
    value_type: str
    sample_value: Any | None = None
    is_array: bool
    depth: int


class MappingJsonPathsResponse(BaseModel):
    """POST /runtime/preview/json-paths response body."""

    total: int
    paths: list[MappingJsonPathItem]
