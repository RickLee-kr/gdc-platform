"""Runtime status and API test endpoints."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.runtime import control_service, preview_service, read_service
from app.runtime.preview_service import PreviewRequestError
from app.runtime.schemas import (
    DashboardSummaryResponse,
    RuntimeFailureTrendResponse,
    RuntimeLogsCleanupRequest,
    RuntimeLogsCleanupResponse,
    RuntimeLogsPageResponse,
    RuntimeStreamControlResponse,
    FormatPreviewRequest,
    FormatPreviewResponse,
    HttpApiTestRequest,
    HttpApiTestResponse,
    MappingPreviewRequest,
    MappingPreviewResponse,
    RouteDeliveryPreviewRequest,
    RouteDeliveryPreviewResponse,
    RuntimeLogSearchResponse,
    RuntimeTimelineResponse,
    StreamHealthResponse,
    StreamRuntimeStatsResponse,
)

router = APIRouter()


@router.get("/status")
async def get_runtime_status() -> dict[str, str]:
    """Placeholder: aggregate scheduler/runner status for UI."""

    return {"message": "placeholder runtime status"}


@router.get("/stats/stream/{stream_id}", response_model=StreamRuntimeStatsResponse)
async def get_stream_runtime_stats(
    stream_id: int,
    db: Session = Depends(get_db),
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


@router.get("/health/stream/{stream_id}", response_model=StreamHealthResponse)
async def get_stream_runtime_health(
    stream_id: int,
    db: Session = Depends(get_db),
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


@router.get("/dashboard/summary", response_model=DashboardSummaryResponse)
async def get_runtime_dashboard_summary(
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=1000),
) -> DashboardSummaryResponse:
    """Cross-stream dashboard: DB aggregates plus recent delivery_logs window (read-only)."""

    return read_service.get_runtime_dashboard_summary(db, limit)


@router.get("/failures/trend", response_model=RuntimeFailureTrendResponse)
async def get_runtime_failure_trend(
    db: Session = Depends(get_db),
    limit: int = Query(1000, ge=1, le=10000),
    stream_id: int | None = Query(None),
    route_id: int | None = Query(None),
    destination_id: int | None = Query(None),
) -> RuntimeFailureTrendResponse:
    """Aggregated failure / rate-limit counts from delivery_logs (read-only; no payload_sample)."""

    return read_service.get_runtime_failure_trend(
        db,
        limit=limit,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )


@router.get("/logs/search", response_model=RuntimeLogSearchResponse)
async def search_runtime_delivery_logs(
    db: Session = Depends(get_db),
    stream_id: int | None = Query(None),
    route_id: int | None = Query(None),
    destination_id: int | None = Query(None),
    stage: str | None = Query(None),
    level: str | None = Query(None),
    status: str | None = Query(None),
    error_code: str | None = Query(None),
    limit: int = Query(100, ge=1, le=1000),
) -> RuntimeLogSearchResponse:
    """Search delivery_logs with optional filters (read-only; no payload_sample)."""

    return read_service.search_runtime_logs(
        db,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        stage=stage,
        level=level,
        status=status,
        error_code=error_code,
        limit=limit,
    )


@router.get("/logs/page", response_model=RuntimeLogsPageResponse)
async def get_runtime_logs_page(
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
    cursor_created_at: datetime | None = Query(None),
    cursor_id: int | None = Query(None),
    stream_id: int | None = Query(None),
    route_id: int | None = Query(None),
    destination_id: int | None = Query(None),
    stage: str | None = Query(None),
    level: str | None = Query(None),
    status: str | None = Query(None),
    error_code: str | None = Query(None),
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

    return read_service.get_runtime_logs_page(
        db,
        limit=limit,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        stage=stage,
        level=level,
        status=status,
        error_code=error_code,
        cursor_created_at=cursor_created_at,
        cursor_id=cursor_id,
    )


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
    db: Session = Depends(get_db),
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


@router.post("/api-test/http", response_model=HttpApiTestResponse)
async def api_test_http(payload: HttpApiTestRequest) -> HttpApiTestResponse:
    """Execute HTTP poll + JSON preview without DB side effects."""

    try:
        return preview_service.run_http_api_test(payload)
    except PreviewRequestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/preview/mapping", response_model=MappingPreviewResponse)
async def preview_mapping(payload: MappingPreviewRequest) -> MappingPreviewResponse:
    """Preview extract -> mapping -> enrichment without runtime side effects."""

    try:
        return preview_service.run_mapping_preview(payload)
    except PreviewRequestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/preview/format", response_model=FormatPreviewResponse)
async def preview_format(payload: FormatPreviewRequest) -> FormatPreviewResponse:
    """Preview destination-formatted messages without any runtime side effects."""

    try:
        return preview_service.run_format_preview(payload)
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
