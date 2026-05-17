"""Read-only runtime health scoring routes.

Mounted under ``/api/v1/runtime/health/*`` from the runtime router. The scoring
pipeline is deterministic (no ML) and aggregates exclusively over
``delivery_logs`` data already exposed by the runtime analytics surface.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db_read_bounded as get_db
from app.runtime import health_service
from app.runtime.health_schemas import (
    DestinationHealthListResponse,
    HealthOverviewResponse,
    RouteHealthDetailResponse,
    RouteHealthListResponse,
    ScoringMode,
    StreamHealthDetailResponse,
    StreamHealthListResponse,
)
from app.runtime.read_service import RouteNotFoundError, StreamNotFoundError

router = APIRouter()

_SCORING_MODE_DESC = (
    "current_runtime = live posture (recent slice + recovery); "
    "historical_analytics = full-window trend scoring for Analytics."
)


@router.get("/overview", response_model=HealthOverviewResponse)
async def health_overview(
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
    worst_limit: int = Query(5, ge=1, le=25),
    scoring_mode: ScoringMode = Query(
        "current_runtime",
        description=_SCORING_MODE_DESC,
    ),
    snapshot_id: str | None = Query(
        None,
        description="Optional ISO-8601 aggregate snapshot timestamp to reuse across health widgets.",
    ),
) -> HealthOverviewResponse:
    """Cross-entity health KPIs and worst-N rankings (read-only)."""

    return health_service.get_health_overview(
        db,
        window=window,
        since=since,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        worst_limit=worst_limit,
        scoring_mode=scoring_mode,
        snapshot_id=snapshot_id,
    )


@router.get("/streams", response_model=StreamHealthListResponse)
async def health_streams(
    db: Session = Depends(get_db),
    window: str | None = Query("24h"),
    since: datetime | None = Query(None),
    stream_id: int | None = Query(None),
    route_id: int | None = Query(None),
    destination_id: int | None = Query(None),
    scoring_mode: ScoringMode = Query("current_runtime", description=_SCORING_MODE_DESC),
    snapshot_id: str | None = Query(None),
) -> StreamHealthListResponse:
    """Per-stream health rows ordered by score asc."""

    return health_service.list_stream_health(
        db,
        window=window,
        since=since,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        scoring_mode=scoring_mode,
        snapshot_id=snapshot_id,
    )


@router.get("/routes", response_model=RouteHealthListResponse)
async def health_routes(
    db: Session = Depends(get_db),
    window: str | None = Query("24h"),
    since: datetime | None = Query(None),
    stream_id: int | None = Query(None),
    route_id: int | None = Query(None),
    destination_id: int | None = Query(None),
    scoring_mode: ScoringMode = Query("current_runtime", description=_SCORING_MODE_DESC),
    snapshot_id: str | None = Query(None),
) -> RouteHealthListResponse:
    """Per-route health rows ordered by score asc."""

    return health_service.list_route_health(
        db,
        window=window,
        since=since,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        scoring_mode=scoring_mode,
        snapshot_id=snapshot_id,
    )


@router.get("/destinations", response_model=DestinationHealthListResponse)
async def health_destinations(
    db: Session = Depends(get_db),
    window: str | None = Query("24h"),
    since: datetime | None = Query(None),
    stream_id: int | None = Query(None),
    route_id: int | None = Query(None),
    destination_id: int | None = Query(None),
    scoring_mode: ScoringMode = Query("current_runtime", description=_SCORING_MODE_DESC),
    snapshot_id: str | None = Query(None),
) -> DestinationHealthListResponse:
    """Per-destination health rows ordered by score asc."""

    return health_service.list_destination_health(
        db,
        window=window,
        since=since,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        scoring_mode=scoring_mode,
        snapshot_id=snapshot_id,
    )


@router.get("/streams/{stream_id}", response_model=StreamHealthDetailResponse)
async def health_stream_detail(
    stream_id: int,
    db: Session = Depends(get_db),
    window: str | None = Query("24h"),
    since: datetime | None = Query(None),
    route_id: int | None = Query(None),
    destination_id: int | None = Query(None),
    scoring_mode: ScoringMode = Query("current_runtime", description=_SCORING_MODE_DESC),
    snapshot_id: str | None = Query(None),
) -> StreamHealthDetailResponse:
    """Single-stream health envelope with explainable factors."""

    try:
        return health_service.get_stream_health_detail(
            db,
            stream_id=stream_id,
            window=window,
            since=since,
            route_id=route_id,
            destination_id=destination_id,
            scoring_mode=scoring_mode,
            snapshot_id=snapshot_id,
        )
    except StreamNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": "STREAM_NOT_FOUND",
                "message": f"stream not found: {exc.stream_id}",
            },
        ) from exc


@router.get("/routes/{route_id}", response_model=RouteHealthDetailResponse)
async def health_route_detail(
    route_id: int,
    db: Session = Depends(get_db),
    window: str | None = Query("24h"),
    since: datetime | None = Query(None),
    stream_id: int | None = Query(None),
    destination_id: int | None = Query(None),
    scoring_mode: ScoringMode = Query("current_runtime", description=_SCORING_MODE_DESC),
    snapshot_id: str | None = Query(None),
) -> RouteHealthDetailResponse:
    """Single-route health envelope with explainable factors."""

    try:
        return health_service.get_route_health_detail(
            db,
            route_id=route_id,
            window=window,
            since=since,
            stream_id=stream_id,
            destination_id=destination_id,
            scoring_mode=scoring_mode,
            snapshot_id=snapshot_id,
        )
    except RouteNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": "ROUTE_NOT_FOUND",
                "message": f"route not found: {exc.route_id}",
            },
        ) from exc
