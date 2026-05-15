"""HTTP API for backfill job registry (Phase 1 foundation)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.backfill.schemas import (
    BackfillJobCreate,
    BackfillJobRead,
    BackfillProgressEventRead,
    BackfillReplayRequest,
)
from app.backfill import service
from app.database import get_db

router = APIRouter()


@router.post("/replay", response_model=BackfillJobRead, status_code=status.HTTP_201_CREATED)
async def replay_stream_backfill(payload: BackfillReplayRequest, db: Session = Depends(get_db)) -> BackfillJobRead:
    """Operational replay: historical window through the existing stream pipeline (checkpoint-safe)."""

    row = service.replay_stream_backfill(db, payload)
    return BackfillJobRead.model_validate(row)


@router.post("/jobs", response_model=BackfillJobRead, status_code=status.HTTP_201_CREATED)
async def create_backfill_job(payload: BackfillJobCreate, db: Session = Depends(get_db)) -> BackfillJobRead:
    row = service.create_backfill_job(db, payload)
    return BackfillJobRead.model_validate(row)


@router.get("/jobs", response_model=list[BackfillJobRead])
async def list_backfill_jobs(
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[BackfillJobRead]:
    rows = service.list_jobs(db, limit=limit)
    return [BackfillJobRead.model_validate(r) for r in rows]


@router.get("/jobs/{job_id}", response_model=BackfillJobRead)
async def get_backfill_job(job_id: int, db: Session = Depends(get_db)) -> BackfillJobRead:
    row = service.get_job(db, job_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="backfill job not found")
    return BackfillJobRead.model_validate(row)


@router.post("/jobs/{job_id}/start", response_model=BackfillJobRead)
async def start_backfill_job(job_id: int, db: Session = Depends(get_db)) -> BackfillJobRead:
    row = service.start_backfill_job(db, job_id)
    return BackfillJobRead.model_validate(row)


@router.post("/jobs/{job_id}/cancel", response_model=BackfillJobRead)
async def cancel_backfill_job(job_id: int, db: Session = Depends(get_db)) -> BackfillJobRead:
    row = service.cancel_backfill_job(db, job_id)
    return BackfillJobRead.model_validate(row)


@router.get("/jobs/{job_id}/events", response_model=list[BackfillProgressEventRead])
async def list_backfill_job_events(job_id: int, db: Session = Depends(get_db)) -> list[BackfillProgressEventRead]:
    if service.get_job(db, job_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="backfill job not found")
    rows = service.list_progress_events(db, job_id)
    return [BackfillProgressEventRead.model_validate(r) for r in rows]
