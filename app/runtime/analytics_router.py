"""Read-only runtime analytics routes (delivery_logs aggregates)."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db_read_bounded as get_db
from app.runtime import analytics_service
from app.runtime.analytics_schemas import (
    RetrySummaryResponse,
    RouteFailuresAnalyticsResponse,
    RouteFailuresScopedResponse,
    StreamRetriesAnalyticsResponse,
)
from app.runtime.read_service import RouteNotFoundError

router = APIRouter()


@router.get("/routes/failures", response_model=RouteFailuresAnalyticsResponse)
async def analytics_route_failures(
    db: Session = Depends(get_db),
    window: str | None = Query(
        "24h",
        description="Rolling window when since is omitted (15m, 1h, 6h, 24h). Default 24h.",
    ),
    since: datetime | None = Query(
        None,
        description="UTC window start; when set, overrides rolling window (label: custom).",
    ),
    stream_id: int | None = Query(None),
    route_id: int | None = Query(None),
    destination_id: int | None = Query(None),
) -> RouteFailuresAnalyticsResponse:
    """Aggregate route failure metrics from delivery_logs."""

    return analytics_service.get_route_failures_analytics(
        db,
        window=window,
        since=since,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )


@router.get("/routes/{route_id}/failures", response_model=RouteFailuresScopedResponse)
async def analytics_route_failures_scoped(
    route_id: int,
    db: Session = Depends(get_db),
    window: str | None = Query(
        "24h",
        description="Rolling window when since is omitted (15m, 1h, 6h, 24h). Default 24h.",
    ),
    since: datetime | None = Query(
        None,
        description="UTC window start; when set, overrides rolling window.",
    ),
    stream_id: int | None = Query(None),
    destination_id: int | None = Query(None),
) -> RouteFailuresScopedResponse:
    """Route-scoped failure analytics."""

    try:
        return analytics_service.get_route_failures_for_route(
            db,
            route_id=route_id,
            window=window,
            since=since,
            stream_id=stream_id,
            destination_id=destination_id,
        )
    except RouteNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "ROUTE_NOT_FOUND", "message": f"route not found: {exc.route_id}"},
        ) from exc


@router.get("/streams/retries", response_model=StreamRetriesAnalyticsResponse)
async def analytics_stream_retries(
    db: Session = Depends(get_db),
    window: str | None = Query("24h"),
    since: datetime | None = Query(None),
    stream_id: int | None = Query(None),
    route_id: int | None = Query(None),
    destination_id: int | None = Query(None),
    limit: int = Query(20, ge=1, le=50),
) -> StreamRetriesAnalyticsResponse:
    """Retry-heavy streams and routes."""

    return analytics_service.get_stream_retries_analytics(
        db,
        window=window,
        since=since,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        limit=limit,
    )


@router.get("/retries/summary", response_model=RetrySummaryResponse)
async def analytics_retries_summary(
    db: Session = Depends(get_db),
    window: str | None = Query("24h"),
    since: datetime | None = Query(None),
    stream_id: int | None = Query(None),
    route_id: int | None = Query(None),
    destination_id: int | None = Query(None),
) -> RetrySummaryResponse:
    """Retry outcome KPIs."""

    return analytics_service.get_retry_summary(
        db,
        window=window,
        since=since,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )

