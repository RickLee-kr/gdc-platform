"""Runtime status and API test endpoints."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.database import get_db, get_db_read_bounded
from app.runtime.dashboard_read_cache import dashboard_read_cache
from app.platform_admin import journal
from app.runtime import control_service, preview_service, read_service
from app.runtime.analytics_router import router as runtime_analytics_router
from app.runtime.health_router import router as runtime_health_router
from app.runtime.metrics_service import build_stream_runtime_metrics
from app.runtime.errors import PreviewRequestError, SourceFetchError
from app.startup_readiness import get_startup_snapshot
from app.runtime.metrics_window import normalize_metrics_window_token
from app.runtime.schemas import (
    ConnectorUIConfigResponse,
    ConnectorUISaveRequest,
    ConnectorUISaveResponse,
    DashboardOutcomeTimeseriesResponse,
    DashboardSummaryResponse,
    DestinationUIConfigResponse,
    DestinationUISaveRequest,
    DestinationUISaveResponse,
    DeliveryFormatDraftPreviewRequest,
    DeliveryFormatDraftPreviewResponse,
    E2EDraftPreviewRequest,
    E2EDraftPreviewResponse,
    FinalEventDraftPreviewRequest,
    FinalEventDraftPreviewResponse,
    RuntimeFailureTrendResponse,
    RuntimeLogsCleanupRequest,
    RuntimeLogsCleanupResponse,
    RuntimeLogsPageResponse,
    RuntimeEnrichmentSaveRequest,
    RuntimeEnrichmentSaveResponse,
    RuntimeMappingSaveRequest,
    RuntimeMappingSaveResponse,
    RuntimeRouteEnabledSaveRequest,
    RuntimeRouteEnabledSaveResponse,
    RuntimeRouteFailurePolicySaveRequest,
    RuntimeRouteFailurePolicySaveResponse,
    RuntimeRouteFormatterSaveRequest,
    RuntimeRouteFormatterSaveResponse,
    RuntimeDestinationRateLimitSaveRequest,
    RuntimeDestinationRateLimitSaveResponse,
    RuntimeRouteRateLimitSaveRequest,
    RuntimeRouteRateLimitSaveResponse,
    RuntimeStreamControlResponse,
    RuntimeStreamRunOnceResponse,
    SourceUIConfigResponse,
    SourceUISaveRequest,
    SourceUISaveResponse,
    StreamUIConfigResponse,
    StreamUISaveRequest,
    StreamUISaveResponse,
    RuntimeStreamRateLimitSaveRequest,
    RuntimeStreamRateLimitSaveResponse,
    FormatPreviewRequest,
    FormatPreviewResponse,
    ConnectorAuthTestRequest,
    ConnectorAuthTestResponse,
    DeliveryPrefixFormatPreviewRequest,
    DeliveryPrefixFormatPreviewResponse,
    HttpApiTestRequest,
    HttpApiTestResponse,
    MappingDraftPreviewRequest,
    MappingDraftPreviewResponse,
    MappingJsonPathsRequest,
    MappingJsonPathsResponse,
    MappingUISaveRequest,
    MappingUISaveResponse,
    MappingUIConfigResponse,
    MappingPreviewRequest,
    MappingPreviewResponse,
    RouteDeliveryPreviewRequest,
    RouteDeliveryPreviewResponse,
    RouteUIConfigResponse,
    RouteUISaveRequest,
    RouteUISaveResponse,
    CheckpointHistoryResponse,
    CheckpointTraceResponse,
    RuntimeLogSearchResponse,
    RuntimeTraceResponse,
    RuntimeAlertSummaryResponse,
    RuntimeSystemResourcesResponse,
    RuntimeTimelineResponse,
    StreamHealthResponse,
    StreamRuntimeMetricsResponse,
    StreamRuntimeStatsHealthBundleResponse,
    StreamRuntimeStatsResponse,
)
from app.runtime.system_resources import collect_runtime_system_resources
from app.validation.schemas import ValidationOperationalSummaryResponse

router = APIRouter()


@router.get("/status")
async def get_runtime_status() -> dict[str, object]:
    """Startup diagnostics: DB target, Alembic revision, schema readiness, scheduler activation."""

    return get_startup_snapshot().as_public_dict()


@router.get("/streams/{stream_id}/mapping-ui/config", response_model=MappingUIConfigResponse)
async def get_stream_mapping_ui_config(
    stream_id: int,
    db: Session = Depends(get_db_read_bounded),
) -> MappingUIConfigResponse:
    """Load stream/source/mapping/enrichment/routes config for Mapping UI screen."""

    try:
        return read_service.get_mapping_ui_config(db, stream_id)
    except read_service.StreamNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {exc.stream_id}"},
        ) from exc


@router.get("/routes/{route_id}/ui/config", response_model=RouteUIConfigResponse)
async def get_route_ui_config(
    route_id: int,
    db: Session = Depends(get_db_read_bounded),
) -> RouteUIConfigResponse:
    """Load route and destination config for Route UI screen."""

    try:
        return read_service.get_route_ui_config(db, route_id)
    except read_service.RouteNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "ROUTE_NOT_FOUND", "message": f"route not found: {exc.route_id}"},
        ) from exc


@router.post("/streams/{stream_id}/mapping-ui/save", response_model=MappingUISaveResponse)
async def save_stream_mapping_ui_config(
    stream_id: int,
    payload: MappingUISaveRequest,
    db: Session = Depends(get_db),
) -> MappingUISaveResponse:
    """Save Mapping UI bundle settings with one transactional commit."""

    try:
        return control_service.save_runtime_mapping_ui_config(db, stream_id, payload)
    except control_service.StreamNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {exc.stream_id}"},
        ) from exc
    except control_service.RouteNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "ROUTE_NOT_FOUND", "message": f"route not found: {exc.route_id}"},
        ) from exc


@router.post("/routes/{route_id}/ui/save", response_model=RouteUISaveResponse)
async def save_route_ui_config(
    route_id: int,
    payload: RouteUISaveRequest,
    db: Session = Depends(get_db),
) -> RouteUISaveResponse:
    """Save Route UI screen settings with one commit."""

    try:
        return control_service.save_runtime_route_ui_config(db, route_id, payload)
    except control_service.RouteNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "ROUTE_NOT_FOUND", "message": f"route not found: {exc.route_id}"},
        ) from exc
    except control_service.DestinationNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": "DESTINATION_NOT_FOUND",
                "message": f"destination not found: {exc.destination_id}",
            },
        ) from exc


@router.get("/destinations/{destination_id}/ui/config", response_model=DestinationUIConfigResponse)
async def get_destination_ui_config(
    destination_id: int,
    db: Session = Depends(get_db_read_bounded),
) -> DestinationUIConfigResponse:
    """Load destination + connected routes config for Destination UI screen."""

    try:
        return read_service.get_destination_ui_config(db, destination_id)
    except read_service.DestinationNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": "DESTINATION_NOT_FOUND",
                "message": f"destination not found: {exc.destination_id}",
            },
        ) from exc


@router.post("/destinations/{destination_id}/ui/save", response_model=DestinationUISaveResponse)
async def save_destination_ui_config(
    destination_id: int,
    payload: DestinationUISaveRequest,
    db: Session = Depends(get_db),
) -> DestinationUISaveResponse:
    """Save Destination UI screen settings with one commit."""

    try:
        return control_service.save_runtime_destination_ui_config(db, destination_id, payload)
    except control_service.DestinationNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": "DESTINATION_NOT_FOUND",
                "message": f"destination not found: {exc.destination_id}",
            },
        ) from exc


@router.get("/streams/{stream_id}/ui/config", response_model=StreamUIConfigResponse)
async def get_stream_ui_config(
    stream_id: int,
    db: Session = Depends(get_db_read_bounded),
) -> StreamUIConfigResponse:
    """Load stream + related summaries for Stream UI screen."""

    try:
        return read_service.get_stream_ui_config(db, stream_id)
    except read_service.StreamNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {exc.stream_id}"},
        ) from exc


@router.post("/streams/{stream_id}/ui/save", response_model=StreamUISaveResponse)
async def save_stream_ui_config(
    stream_id: int,
    payload: StreamUISaveRequest,
    db: Session = Depends(get_db),
) -> StreamUISaveResponse:
    """Save Stream UI screen settings with one commit."""

    try:
        return control_service.save_runtime_stream_ui_config(db, stream_id, payload)
    except control_service.StreamNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {exc.stream_id}"},
        ) from exc


@router.get("/sources/{source_id}/ui/config", response_model=SourceUIConfigResponse)
async def get_source_ui_config(
    source_id: int,
    db: Session = Depends(get_db_read_bounded),
) -> SourceUIConfigResponse:
    """Load source + connected streams config for Source UI screen."""

    try:
        return read_service.get_source_ui_config(db, source_id)
    except read_service.SourceNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "SOURCE_NOT_FOUND", "message": f"source not found: {exc.source_id}"},
        ) from exc


@router.post("/sources/{source_id}/ui/save", response_model=SourceUISaveResponse)
async def save_source_ui_config(
    source_id: int,
    payload: SourceUISaveRequest,
    db: Session = Depends(get_db),
) -> SourceUISaveResponse:
    """Save Source UI screen settings with one commit."""

    try:
        return control_service.save_runtime_source_ui_config(db, source_id, payload)
    except control_service.SourceNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "SOURCE_NOT_FOUND", "message": f"source not found: {exc.source_id}"},
        ) from exc


@router.get("/connectors/{connector_id}/ui/config", response_model=ConnectorUIConfigResponse)
async def get_connector_ui_config(
    connector_id: int,
    db: Session = Depends(get_db_read_bounded),
) -> ConnectorUIConfigResponse:
    """Load connector + source/stream summaries for Connector UI screen."""

    try:
        return read_service.get_connector_ui_config(db, connector_id)
    except read_service.ConnectorNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "CONNECTOR_NOT_FOUND", "message": f"connector not found: {exc.connector_id}"},
        ) from exc


@router.post("/connectors/{connector_id}/ui/save", response_model=ConnectorUISaveResponse)
async def save_connector_ui_config(
    connector_id: int,
    payload: ConnectorUISaveRequest,
    db: Session = Depends(get_db),
) -> ConnectorUISaveResponse:
    """Save Connector UI screen settings with one commit."""

    try:
        return control_service.save_runtime_connector_ui_config(db, connector_id, payload)
    except control_service.ConnectorNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "CONNECTOR_NOT_FOUND", "message": f"connector not found: {exc.connector_id}"},
        ) from exc


@router.get("/stats/stream/{stream_id}", response_model=StreamRuntimeStatsResponse)
async def get_stream_runtime_stats(
    stream_id: int,
    db: Session = Depends(get_db_read_bounded),
    limit: int = Query(100, ge=1, le=1000),
) -> StreamRuntimeStatsResponse:
    """Summarize recent committed delivery_logs and checkpoint for a stream (read-only)."""

    try:
        return read_service.get_stream_runtime_stats(db, stream_id, limit)
    except read_service.StreamNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {exc.stream_id}"},
        ) from exc


@router.get("/streams/{stream_id}/metrics", response_model=StreamRuntimeMetricsResponse)
async def get_stream_runtime_metrics(
    stream_id: int,
    db: Session = Depends(get_db_read_bounded),
    window: str = Query(
        "1h",
        description="Rolling window for KPIs and charts (15m, 1h, 6h, 24h).",
    ),
) -> StreamRuntimeMetricsResponse:
    """Stream Runtime panel: KPIs, time buckets, route rows, checkpoint snapshot, recent runs (read-only)."""

    try:
        w = normalize_metrics_window_token(window)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        return build_stream_runtime_metrics(db, stream_id, window=w)
    except read_service.StreamNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {exc.stream_id}"},
        ) from exc


@router.get("/health/stream/{stream_id}", response_model=StreamHealthResponse)
async def get_stream_runtime_health(
    stream_id: int,
    db: Session = Depends(get_db_read_bounded),
    limit: int = Query(100, ge=1, le=1000),
) -> StreamHealthResponse:
    """Per-route and stream health from recent delivery_logs (read-only)."""

    try:
        return read_service.get_stream_runtime_health(db, stream_id, limit)
    except read_service.StreamNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {exc.stream_id}"},
        ) from exc


@router.get("/streams/{stream_id}/stats-health", response_model=StreamRuntimeStatsHealthBundleResponse)
async def get_stream_runtime_stats_health_bundle(
    stream_id: int,
    db: Session = Depends(get_db_read_bounded),
    limit: int = Query(100, ge=1, le=1000),
) -> StreamRuntimeStatsHealthBundleResponse:
    """Stats + health with one delivery_logs scan (reduces duplicate work vs separate GETs)."""

    try:
        return read_service.get_stream_runtime_stats_and_health(db, stream_id, limit)
    except read_service.StreamNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {exc.stream_id}"},
        ) from exc


@router.get("/dashboard/summary", response_model=DashboardSummaryResponse)
async def get_runtime_dashboard_summary(
    limit: int = Query(100, ge=1, le=1000),
    window: str = Query(
        "1h",
        description="Recent delivery_logs window (15m, 1h, 6h, 24h).",
    ),
) -> DashboardSummaryResponse:
    """Cross-stream dashboard: DB aggregates plus recent delivery_logs window (read-only)."""

    try:
        w = normalize_metrics_window_token(window)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await dashboard_read_cache.get_summary(limit, w)


@router.get("/validation/operational-summary", response_model=ValidationOperationalSummaryResponse)
async def get_runtime_validation_operational_summary(
    db: Session = Depends(get_db_read_bounded),
) -> ValidationOperationalSummaryResponse:
    """Continuous validation alert posture and recovery timeline (read-only)."""

    return read_service.get_validation_operational_summary(db)


@router.get("/dashboard/outcome-timeseries", response_model=DashboardOutcomeTimeseriesResponse)
async def get_dashboard_outcome_timeseries(
    window: str = Query(
        "1h",
        description="Rolling delivery_logs window for stacked outcome buckets (15m, 1h, 6h, 24h).",
    ),
) -> DashboardOutcomeTimeseriesResponse:
    """Cross-stream outcome buckets for dashboard charts (read-only)."""

    try:
        w = normalize_metrics_window_token(window)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await dashboard_read_cache.get_outcome_timeseries(w)


@router.get("/failures/trend", response_model=RuntimeFailureTrendResponse)
async def get_runtime_failure_trend(
    db: Session = Depends(get_db_read_bounded),
    limit: int = Query(1000, ge=1, le=10000),
    stream_id: int | None = Query(None),
    route_id: int | None = Query(None),
    destination_id: int | None = Query(None),
    window: str = Query(
        "1h",
        description="Restrict aggregation to rows newer than window end minus this duration.",
    ),
) -> RuntimeFailureTrendResponse:
    """Aggregated failure / rate-limit counts from delivery_logs (read-only; no payload_sample)."""

    try:
        w = normalize_metrics_window_token(window)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return read_service.get_runtime_failure_trend(
        db,
        limit=limit,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        window=w,
    )


@router.get("/logs/search", response_model=RuntimeLogSearchResponse)
async def search_runtime_delivery_logs(
    db: Session = Depends(get_db_read_bounded),
    stream_id: int | None = Query(None),
    route_id: int | None = Query(None),
    destination_id: int | None = Query(None),
    run_id: str | None = Query(None, description="Correlation id for one StreamRunner execution."),
    stage: str | None = Query(None),
    level: str | None = Query(None),
    status: str | None = Query(None),
    error_code: str | None = Query(None),
    partial_success: bool | None = Query(
        None,
        description="When set, restricts to run_complete rows with matching payload_sample.partial_success.",
    ),
    limit: int = Query(100, ge=1, le=1000),
    window: str = Query(
        "1h",
        description="Only include rows with created_at within this rolling window.",
    ),
) -> RuntimeLogSearchResponse:
    """Search delivery_logs with optional filters (read-only; no payload_sample)."""

    try:
        w = normalize_metrics_window_token(window)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return read_service.search_runtime_logs(
        db,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        run_id=run_id,
        stage=stage,
        level=level,
        status=status,
        error_code=error_code,
        partial_success=partial_success,
        limit=limit,
        window=w,
    )


@router.get("/logs/alerts/summary", response_model=RuntimeAlertSummaryResponse)
async def get_runtime_alert_summary(
    db: Session = Depends(get_db_read_bounded),
    window: str = Query(
        "1h",
        description="Rolling window for WARN/ERROR aggregation (15m, 1h, 6h, 24h).",
    ),
    limit: int = Query(100, ge=1, le=500),
) -> RuntimeAlertSummaryResponse:
    """Grouped WARN/ERROR summaries with stream and connector names."""

    try:
        w = normalize_metrics_window_token(window)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return read_service.get_runtime_alert_summary(db, window=w, limit=limit)


@router.get("/system/resources", response_model=RuntimeSystemResourcesResponse)
async def get_runtime_system_resources() -> RuntimeSystemResourcesResponse:
    """Lightweight local CPU/memory/disk/network snapshot for the API host process."""

    return collect_runtime_system_resources()


@router.get("/logs/page", response_model=RuntimeLogsPageResponse)
async def get_runtime_logs_page(
    db: Session = Depends(get_db_read_bounded),
    limit: int = Query(100, ge=1, le=500),
    cursor_created_at: datetime | None = Query(None),
    cursor_id: int | None = Query(None),
    stream_id: int | None = Query(None),
    route_id: int | None = Query(None),
    destination_id: int | None = Query(None),
    run_id: str | None = Query(None, description="Correlation id for one StreamRunner execution."),
    stage: str | None = Query(None),
    level: str | None = Query(None),
    status: str | None = Query(None),
    error_code: str | None = Query(None),
    partial_success: bool | None = Query(
        None,
        description="When set, restricts to run_complete rows with matching payload_sample.partial_success.",
    ),
    window: str | None = Query(
        None,
        description="Optional rolling window (15m, 1h, 6h, 24h) — filters rows by created_at.",
    ),
) -> RuntimeLogsPageResponse:
    """Cursor-paged delivery_logs (read-only; no payload_sample)."""

    if (cursor_created_at is None) ^ (cursor_id is None):
        raise HTTPException(
            status_code=422,
            detail={
                "error_code": "INVALID_CURSOR",
                "message": "cursor_created_at and cursor_id must both be set or both omitted",
            },
        )

    w_token: str | None = None
    if window is not None and str(window).strip() != "":
        try:
            w_token = normalize_metrics_window_token(window)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    return read_service.get_runtime_logs_page(
        db,
        limit=limit,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        run_id=run_id,
        stage=stage,
        level=level,
        status=status,
        error_code=error_code,
        partial_success=partial_success,
        cursor_created_at=cursor_created_at,
        cursor_id=cursor_id,
        window=w_token,
    )


@router.get("/checkpoints/trace", response_model=CheckpointTraceResponse)
async def get_checkpoint_trace(
    db: Session = Depends(get_db_read_bounded),
    run_id: str = Query(..., min_length=8, description="StreamRunner execution correlation id."),
    stream_id: int | None = Query(None, description="Optional stream scope when run_id is ambiguous."),
) -> CheckpointTraceResponse:
    """Operational checkpoint trace for one run (read-only)."""

    try:
        return read_service.get_checkpoint_trace_for_run(db, run_id.strip(), stream_id=stream_id)
    except read_service.RunTraceNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "CHECKPOINT_TRACE_NOT_FOUND", "message": f"no logs for run_id: {exc.run_id}"},
        ) from exc


@router.get("/checkpoints/streams/{stream_id}/history", response_model=CheckpointHistoryResponse)
async def get_stream_checkpoint_history(
    stream_id: int,
    db: Session = Depends(get_db_read_bounded),
    limit: int = Query(50, ge=1, le=200),
) -> CheckpointHistoryResponse:
    """Recent checkpoint_update rows for a stream (read-only)."""

    try:
        return read_service.get_stream_checkpoint_history(db, stream_id, limit=limit)
    except read_service.StreamNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {exc.stream_id}"},
        ) from exc


@router.get("/runs/{run_id}/checkpoint", response_model=CheckpointTraceResponse)
async def get_run_checkpoint_summary(run_id: str, db: Session = Depends(get_db_read_bounded)) -> CheckpointTraceResponse:
    """Checkpoint-focused summary for one run_id (same payload as /checkpoints/trace)."""

    rid = run_id.strip()
    try:
        return read_service.get_checkpoint_trace_for_run(db, rid, stream_id=None)
    except read_service.RunTraceNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "RUN_CHECKPOINT_NOT_FOUND", "message": f"no logs for run_id: {exc.run_id}"},
        ) from exc


@router.get("/logs/{log_id}/trace", response_model=RuntimeTraceResponse)
async def get_delivery_log_trace(log_id: int, db: Session = Depends(get_db_read_bounded)) -> RuntimeTraceResponse:
    """Timeline for one delivery_logs row; expands to full run when run_id is present."""

    try:
        return read_service.get_runtime_trace_for_delivery_log(db, log_id)
    except read_service.DeliveryLogNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "DELIVERY_LOG_NOT_FOUND", "message": f"log not found: {exc.log_id}"},
        ) from exc


@router.get("/runs/{run_id}/trace", response_model=RuntimeTraceResponse)
async def get_run_trace(run_id: str, db: Session = Depends(get_db_read_bounded)) -> RuntimeTraceResponse:
    """Timeline for all delivery_logs rows sharing run_id (one stream execution)."""

    try:
        return read_service.get_runtime_trace_for_run(db, run_id)
    except read_service.RunTraceNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "RUN_TRACE_NOT_FOUND", "message": f"no logs for run_id: {exc.run_id}"},
        ) from exc


@router.post("/logs/cleanup", response_model=RuntimeLogsCleanupResponse)
async def cleanup_runtime_logs(
    payload: RuntimeLogsCleanupRequest,
    db: Session = Depends(get_db),
) -> RuntimeLogsCleanupResponse:
    """Remove old delivery_logs by age, or dry-run count only (single commit when not dry_run)."""

    return control_service.cleanup_delivery_logs(
        db,
        older_than_days=payload.older_than_days,
        dry_run=payload.dry_run,
    )


@router.get("/timeline/stream/{stream_id}", response_model=RuntimeTimelineResponse)
async def get_stream_runtime_timeline(
    stream_id: int,
    db: Session = Depends(get_db_read_bounded),
    limit: int = Query(100, ge=1, le=500),
    stage: str | None = Query(None),
    level: str | None = Query(None),
    status: str | None = Query(None),
    route_id: int | None = Query(None),
    destination_id: int | None = Query(None),
) -> RuntimeTimelineResponse:
    """delivery_logs timeline for one stream: chronological order (read-only; no payload_sample)."""

    try:
        return read_service.get_stream_runtime_timeline(
            db,
            stream_id,
            limit=limit,
            stage=stage,
            level=level,
            status=status,
            route_id=route_id,
            destination_id=destination_id,
        )
    except read_service.StreamNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {exc.stream_id}"},
        ) from exc


@router.post("/streams/{stream_id}/start", response_model=RuntimeStreamControlResponse)
async def start_runtime_stream(stream_id: int, db: Session = Depends(get_db)) -> RuntimeStreamControlResponse:
    """Enable stream and set status to RUNNING (single commit; does not invoke StreamRunner)."""

    try:
        return control_service.start_stream(db, stream_id)
    except control_service.StreamNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {exc.stream_id}"},
        ) from exc


@router.post("/streams/{stream_id}/stop", response_model=RuntimeStreamControlResponse)
async def stop_runtime_stream(stream_id: int, db: Session = Depends(get_db)) -> RuntimeStreamControlResponse:
    """Disable stream and set status to STOPPED (single commit; does not invoke StreamRunner)."""

    try:
        return control_service.stop_stream(db, stream_id)
    except control_service.StreamNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {exc.stream_id}"},
        ) from exc


@router.post("/streams/{stream_id}/run-once", response_model=RuntimeStreamRunOnceResponse)
async def run_stream_once(stream_id: int, db: Session = Depends(get_db)) -> RuntimeStreamRunOnceResponse:
    """Execute one StreamRunner cycle with DB-backed delivery_logs + checkpoint (manual / verification)."""

    from app.runners.stream_loader import load_stream_context
    from app.runners.stream_runner import StreamRunner

    try:
        context = load_stream_context(db, stream_id, require_enabled_stream=False)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "STREAM_RUN_UNAVAILABLE", "message": str(exc)},
        ) from exc

    runner = StreamRunner()
    try:
        summary = runner.run(context, db=db)
    except SourceFetchError as exc:
        detail: dict = {"error_code": "STREAM_SOURCE_FETCH_FAILED", "message": str(exc)}
        if getattr(exc, "detail", None):
            detail.update(exc.detail)
        raise HTTPException(status_code=502, detail=detail) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error_code": "STREAM_RUN_FAILED", "message": str(exc)},
        ) from exc

    oc_raw = str(summary.get("outcome") or "completed")
    oc: str = oc_raw if oc_raw in ("completed", "skipped_lock", "no_events") else "completed"

    journal.record_audit_event(
        db,
        action="MANUAL_RUN",
        actor_username="system",
        entity_type="STREAM",
        entity_id=stream_id,
        details={
            "outcome": oc,
            "checkpoint_updated": bool(summary.get("checkpoint_updated")),
            "delivered_batch_event_count": summary.get("delivered_batch_event_count"),
        },
    )
    db.commit()

    return RuntimeStreamRunOnceResponse(
        stream_id=int(summary.get("stream_id", stream_id)),
        outcome=oc,  # type: ignore[arg-type]
        message=str(summary["message"]) if summary.get("message") else None,
        extracted_event_count=summary.get("extracted_event_count"),
        mapped_event_count=summary.get("mapped_event_count"),
        enriched_event_count=summary.get("enriched_event_count"),
        delivered_batch_event_count=summary.get("delivered_batch_event_count"),
        checkpoint_updated=bool(summary.get("checkpoint_updated")),
        transaction_committed=bool(summary.get("transaction_committed")),
    )


@router.post("/mappings/stream/{stream_id}/save", response_model=RuntimeMappingSaveResponse)
async def save_runtime_stream_mapping(
    stream_id: int,
    payload: RuntimeMappingSaveRequest,
    db: Session = Depends(get_db),
) -> RuntimeMappingSaveResponse:
    """Persist Mapping draft (event_array_path + field_mappings_json) for a stream; single DB commit."""

    try:
        return control_service.save_runtime_stream_mapping(db, stream_id, payload)
    except control_service.StreamNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {exc.stream_id}"},
        ) from exc


@router.post("/enrichments/stream/{stream_id}/save", response_model=RuntimeEnrichmentSaveResponse)
async def save_runtime_stream_enrichment(
    stream_id: int,
    payload: RuntimeEnrichmentSaveRequest,
    db: Session = Depends(get_db),
) -> RuntimeEnrichmentSaveResponse:
    """Persist Enrichment draft (enrichment_json + override_policy + enabled) for a stream; single DB commit."""

    try:
        return control_service.save_runtime_stream_enrichment(db, stream_id, payload)
    except control_service.StreamNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {exc.stream_id}"},
        ) from exc


@router.post("/routes/{route_id}/formatter/save", response_model=RuntimeRouteFormatterSaveResponse)
async def save_runtime_route_formatter_config(
    route_id: int,
    payload: RuntimeRouteFormatterSaveRequest,
    db: Session = Depends(get_db),
) -> RuntimeRouteFormatterSaveResponse:
    """Persist Route-level formatter override config; single DB commit."""

    try:
        return control_service.save_runtime_route_formatter_config(db, route_id, payload)
    except control_service.RouteNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "ROUTE_NOT_FOUND", "message": f"route not found: {exc.route_id}"},
        ) from exc


@router.post("/routes/{route_id}/failure-policy/save", response_model=RuntimeRouteFailurePolicySaveResponse)
async def save_runtime_route_failure_policy(
    route_id: int,
    payload: RuntimeRouteFailurePolicySaveRequest,
    db: Session = Depends(get_db),
) -> RuntimeRouteFailurePolicySaveResponse:
    """Persist Route-level failure policy config; single DB commit."""

    try:
        return control_service.save_runtime_route_failure_policy(db, route_id, payload)
    except control_service.RouteNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "ROUTE_NOT_FOUND", "message": f"route not found: {exc.route_id}"},
        ) from exc


@router.post("/routes/{route_id}/enabled/save", response_model=RuntimeRouteEnabledSaveResponse)
async def save_runtime_route_enabled_state(
    route_id: int,
    payload: RuntimeRouteEnabledSaveRequest,
    db: Session = Depends(get_db),
) -> RuntimeRouteEnabledSaveResponse:
    """Persist Route.enabled toggle only; single DB commit."""

    try:
        return control_service.save_runtime_route_enabled_state(db, route_id, payload)
    except control_service.RouteNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "ROUTE_NOT_FOUND", "message": f"route not found: {exc.route_id}"},
        ) from exc


@router.post("/routes/{route_id}/rate-limit/save", response_model=RuntimeRouteRateLimitSaveResponse)
async def save_runtime_route_rate_limit(
    route_id: int,
    payload: RuntimeRouteRateLimitSaveRequest,
    db: Session = Depends(get_db),
) -> RuntimeRouteRateLimitSaveResponse:
    """Persist Route-level destination send rate-limit config; single DB commit."""

    try:
        return control_service.save_runtime_route_rate_limit(db, route_id, payload)
    except control_service.RouteNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "ROUTE_NOT_FOUND", "message": f"route not found: {exc.route_id}"},
        ) from exc


@router.post("/streams/{stream_id}/rate-limit/save", response_model=RuntimeStreamRateLimitSaveResponse)
async def save_runtime_stream_rate_limit(
    stream_id: int,
    payload: RuntimeStreamRateLimitSaveRequest,
    db: Session = Depends(get_db),
) -> RuntimeStreamRateLimitSaveResponse:
    """Persist Stream-level source/API rate-limit config; single DB commit."""

    try:
        return control_service.save_runtime_stream_rate_limit(db, stream_id, payload)
    except control_service.StreamNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {exc.stream_id}"},
        ) from exc


@router.post("/destinations/{destination_id}/rate-limit/save", response_model=RuntimeDestinationRateLimitSaveResponse)
async def save_runtime_destination_rate_limit(
    destination_id: int,
    payload: RuntimeDestinationRateLimitSaveRequest,
    db: Session = Depends(get_db),
) -> RuntimeDestinationRateLimitSaveResponse:
    """Persist Destination-level send rate-limit config; single DB commit."""

    try:
        return control_service.save_runtime_destination_rate_limit(db, destination_id, payload)
    except control_service.DestinationNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": "DESTINATION_NOT_FOUND",
                "message": f"destination not found: {exc.destination_id}",
            },
        ) from exc


@router.post("/api-test/http", response_model=HttpApiTestResponse)
async def api_test_http(payload: HttpApiTestRequest, request: Request, db: Session = Depends(get_db)) -> HttpApiTestResponse:
    """Execute HTTP poll + JSON preview without DB side effects."""

    try:
        return preview_service.run_http_api_test(payload, db, api_origin=str(request.base_url).rstrip("/"))
    except PreviewRequestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/api-test/connector-auth", response_model=ConnectorAuthTestResponse)
async def api_test_connector_auth(
    payload: ConnectorAuthTestRequest,
    db: Session = Depends(get_db),
) -> ConnectorAuthTestResponse:
    """Validate connector authentication only (no stream endpoint)."""

    try:
        return preview_service.run_connector_auth_test(payload, db)
    except PreviewRequestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/preview/mapping", response_model=MappingPreviewResponse)
async def preview_mapping(payload: MappingPreviewRequest) -> MappingPreviewResponse:
    """Preview extract -> mapping -> enrichment without runtime side effects."""

    try:
        return preview_service.run_mapping_preview(payload)
    except PreviewRequestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/preview/mapping-draft", response_model=MappingDraftPreviewResponse)
async def preview_mapping_draft(payload: MappingDraftPreviewRequest) -> MappingDraftPreviewResponse:
    """Preview mapping results from selected JSONPath rules without DB writes."""

    try:
        return preview_service.run_mapping_draft_preview(payload)
    except PreviewRequestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/preview/final-event-draft", response_model=FinalEventDraftPreviewResponse)
async def preview_final_event_draft(payload: FinalEventDraftPreviewRequest) -> FinalEventDraftPreviewResponse:
    """Preview mapping + enrichment final events without DB writes."""

    try:
        return preview_service.run_final_event_draft_preview(payload)
    except PreviewRequestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/preview/delivery-format-draft", response_model=DeliveryFormatDraftPreviewResponse)
async def preview_delivery_format_draft(
    payload: DeliveryFormatDraftPreviewRequest,
) -> DeliveryFormatDraftPreviewResponse:
    """Preview destination-formatted messages from final events without DB writes."""

    try:
        return preview_service.run_delivery_format_draft_preview(payload)
    except PreviewRequestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/preview/e2e-draft", response_model=E2EDraftPreviewResponse)
async def preview_e2e_draft(payload: E2EDraftPreviewRequest) -> E2EDraftPreviewResponse:
    """Preview mapping -> enrichment -> delivery format in one read-only call."""

    try:
        return preview_service.run_e2e_draft_preview(payload)
    except PreviewRequestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/preview/json-paths", response_model=MappingJsonPathsResponse)
async def preview_mapping_json_paths(payload: MappingJsonPathsRequest) -> MappingJsonPathsResponse:
    """Enumerate scalar JSONPath candidates from an in-memory payload for Mapping UI (read-only)."""

    return preview_service.extract_mapping_json_paths(payload)


@router.post("/preview/format", response_model=FormatPreviewResponse)
async def preview_format(payload: FormatPreviewRequest) -> FormatPreviewResponse:
    """Preview destination-formatted messages without any runtime side effects."""

    try:
        return preview_service.run_format_preview(payload)
    except PreviewRequestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/format-preview", response_model=DeliveryPrefixFormatPreviewResponse)
async def format_preview_delivery_prefix(
    payload: DeliveryPrefixFormatPreviewRequest,
) -> DeliveryPrefixFormatPreviewResponse:
    """Resolve message prefix variables and show final wire payload (read-only)."""

    try:
        return preview_service.run_delivery_prefix_format_preview(payload)
    except PreviewRequestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/preview/route-delivery", response_model=RouteDeliveryPreviewResponse)
async def preview_route_delivery(
    payload: RouteDeliveryPreviewRequest,
    db: Session = Depends(get_db),
) -> RouteDeliveryPreviewResponse:
    """Preview sender-ready payloads for a DB-backed Route without sending or mutating runtime state."""

    try:
        return preview_service.run_route_delivery_preview(db, payload)
    except PreviewRequestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


router.include_router(runtime_analytics_router, prefix="/analytics", tags=["runtime-analytics"])
router.include_router(runtime_health_router, prefix="/health", tags=["runtime-health"])
