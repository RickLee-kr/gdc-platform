"""Pydantic schemas for runtime read-only APIs."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, StrictBool, field_validator


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


class MappingUIConfigMapping(BaseModel):
    exists: bool
    event_array_path: str | None
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


class MappingDraftPreviewRequest(BaseModel):
    payload: dict[str, Any] | list[Any]
    event_array_path: str | None = None
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
    destination_type: Literal["SYSLOG_UDP", "SYSLOG_TCP", "WEBHOOK_POST"]
    formatter_config: dict[str, Any] = Field(default_factory=dict)
    max_events: int = Field(default=5, ge=1, le=100)


class DeliveryFormatDraftPreviewResponse(BaseModel):
    input_event_count: int
    preview_event_count: int
    destination_type: str
    preview_messages: list[Any]
    message: str


class E2EDraftPreviewRequest(BaseModel):
    payload: dict[str, Any] | list[Any]
    event_array_path: str | None = None
    field_mappings: dict[str, str] = Field(default_factory=dict)
    enrichment: dict[str, Any] = Field(default_factory=dict)
    override_policy: Literal["KEEP_EXISTING", "OVERRIDE", "ERROR_ON_CONFLICT"] = "KEEP_EXISTING"
    destination_type: Literal["SYSLOG_UDP", "SYSLOG_TCP", "WEBHOOK_POST"]
    formatter_config: dict[str, Any] = Field(default_factory=dict)
    max_events: int = Field(default=5, ge=1, le=100)


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
