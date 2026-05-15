"""Backfill job orchestration (API-facing; short DB transactions)."""

from __future__ import annotations

import copy
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.backfill.models import BackfillJob, BackfillProgressEvent
from app.backfill.repository import (
    acquire_stream_backfill_xact_lock,
    count_active_backfills_on_stream,
    get_backfill_job,
    get_backfill_job_for_update,
    get_stream_with_source,
    insert_backfill_job,
    list_backfill_jobs,
    list_progress_events_for_job,
    save_job,
    stage_progress_event,
)
from app.backfill.runtime import BackfillRuntimeCoordinator
from app.backfill.schemas import BackfillJobCreate, BackfillReplayRequest
from app.backfill.worker import BackfillWorker
from app.database import utcnow

_ALLOWED_MODES = frozenset(
    {
        "CHECKPOINT_REWIND",
        "TIME_RANGE_REPLAY",
        "OBJECT_REPLAY",
        "FILE_REPLAY",
        "INITIAL_FILL",
    }
)

_DEFAULT_PROGRESS: dict[str, Any] = {"phase": "queued", "chunks_done": 0, "chunks_total": None}

_coordinator_singleton = BackfillRuntimeCoordinator()


def get_coordinator() -> BackfillRuntimeCoordinator:
    """Process-wide coordinator instance (Phase 1; future: injectable / worker-scoped)."""

    return _coordinator_singleton


def _build_source_config_snapshot(stream: Any) -> dict[str, Any]:
    src = stream.source
    return {
        "stream": {
            "id": int(stream.id),
            "name": stream.name,
            "stream_type": stream.stream_type,
            "config_json": copy.deepcopy(stream.config_json or {}),
        },
        "source": (
            {
                "id": int(src.id),
                "source_type": src.source_type,
                "config_json": copy.deepcopy(src.config_json or {}),
            }
            if src is not None
            else {}
        ),
    }


def replay_stream_backfill(db: Session, payload: BackfillReplayRequest) -> BackfillJob:
    """Create a TIME_RANGE_REPLAY job and run it synchronously through StreamRunner."""

    if payload.start_time >= payload.end_time:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="start_time must be before end_time",
        )
    create_payload = BackfillJobCreate(
        stream_id=int(payload.stream_id),
        backfill_mode="TIME_RANGE_REPLAY",
        requested_by=str(payload.requested_by or "unknown")[:256],
        runtime_options_json={
            "start_time": payload.start_time.isoformat(),
            "end_time": payload.end_time.isoformat(),
            "dry_run": bool(payload.dry_run),
        },
    )
    job = create_backfill_job(db, create_payload)
    return start_backfill_job(db, int(job.id))


def create_backfill_job(db: Session, payload: BackfillJobCreate) -> BackfillJob:
    if str(payload.backfill_mode) not in _ALLOWED_MODES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid backfill_mode")

    stream = get_stream_with_source(db, payload.stream_id)
    if stream is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="stream not found")

    coord = get_coordinator()
    ck_snap = coord.capture_checkpoint_snapshot(db, int(stream.id))

    row = BackfillJob(
        stream_id=int(stream.id),
        source_type=str(stream.stream_type),
        status="PENDING",
        backfill_mode=str(payload.backfill_mode),
        requested_by=str(payload.requested_by or "unknown")[:256],
        source_config_snapshot_json=_build_source_config_snapshot(stream),
        checkpoint_snapshot_json=ck_snap,
        runtime_options_json=copy.deepcopy(payload.runtime_options_json or {}),
        progress_json=copy.deepcopy(_DEFAULT_PROGRESS),
        delivery_summary_json=None,
        error_summary=None,
    )
    job = insert_backfill_job(db, row)
    coord.register_job_session(job.id, checkpoint_snapshot=ck_snap)
    stage_progress_event(
        db,
        backfill_job_id=int(job.id),
        stream_id=int(job.stream_id),
        event_type="job_created",
        level="INFO",
        message="Backfill job registered",
        progress_json={"backfill_mode": job.backfill_mode},
    )
    db.commit()
    db.refresh(job)
    return job


def list_jobs(db: Session, *, limit: int = 100) -> list[BackfillJob]:
    return list_backfill_jobs(db, limit=limit)


def get_job(db: Session, job_id: int) -> BackfillJob | None:
    return get_backfill_job(db, job_id)


def list_progress_events(db: Session, job_id: int) -> list[BackfillProgressEvent]:
    return list_progress_events_for_job(db, job_id)


def _raise_invalid_transition(current: str, action: str) -> None:
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"invalid backfill job status transition ({action}) from {current}",
    )


def start_backfill_job(db: Session, job_id: int) -> BackfillJob:
    """PENDING → RUNNING with stream-level lock; then worker dry-run lifecycle (non-blocking)."""

    probe = get_backfill_job(db, job_id)
    if probe is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="backfill job not found")

    stream_id = int(probe.stream_id)
    acquire_stream_backfill_xact_lock(db, stream_id)
    job = get_backfill_job_for_update(db, job_id)
    if job is None:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="backfill job not found")

    if job.status != "PENDING":
        db.rollback()
        _raise_invalid_transition(job.status, "start")

    if count_active_backfills_on_stream(db, stream_id, exclude_job_id=int(job.id)) > 0:
        stage_progress_event(
            db,
            backfill_job_id=int(job.id),
            stream_id=stream_id,
            event_type="job_failed",
            level="WARNING",
            message="Start rejected: another backfill job is already active for this stream",
            error_code="CONCURRENT_BACKFILL_ACTIVE",
            progress_json={"blocked": True},
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="another backfill job is already active for this stream",
        )

    now = utcnow()
    job.status = "RUNNING"
    if job.started_at is None:
        job.started_at = now
    stage_progress_event(
        db,
        backfill_job_id=int(job.id),
        stream_id=stream_id,
        event_type="job_started",
        level="INFO",
        message="Backfill job started",
        progress_json={"phase": "starting"},
    )
    db.commit()
    db.refresh(job)

    coord = get_coordinator()
    coord.register_job_session(job.id, checkpoint_snapshot=job.checkpoint_snapshot_json)
    worker = BackfillWorker(db, coord)
    worker.start_job(int(job.id))
    db.refresh(job)
    return get_backfill_job(db, job_id) or job


def cancel_backfill_job(db: Session, job_id: int) -> BackfillJob:
    probe = get_backfill_job(db, job_id)
    if probe is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="backfill job not found")

    stream_id = int(probe.stream_id)
    coord = get_coordinator()

    # PENDING: single transaction to CANCELLED
    if probe.status == "PENDING":
        acquire_stream_backfill_xact_lock(db, stream_id)
        job = get_backfill_job_for_update(db, job_id)
        if job is None or job.status != "PENDING":
            db.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="backfill job status changed")
        job.status = "CANCELLED"
        stage_progress_event(
            db,
            backfill_job_id=int(job.id),
            stream_id=stream_id,
            event_type="cancellation_requested",
            level="INFO",
            message="Cancellation requested",
        )
        stage_progress_event(
            db,
            backfill_job_id=int(job.id),
            stream_id=stream_id,
            event_type="job_cancelled",
            level="INFO",
            message="Backfill job cancelled",
        )
        db.commit()
        coord.clear_job_session(int(job_id))
        db.refresh(job)
        return job

    if probe.status == "RUNNING":
        acquire_stream_backfill_xact_lock(db, stream_id)
        job = get_backfill_job_for_update(db, job_id)
        if job is None or job.status != "RUNNING":
            db.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="backfill job status changed")
        job.status = "CANCELLING"
        coord.request_cancel(int(job_id))
        stage_progress_event(
            db,
            backfill_job_id=int(job.id),
            stream_id=stream_id,
            event_type="cancellation_requested",
            level="INFO",
            message="Cancellation requested",
        )
        db.commit()
        db.refresh(job)

        acquire_stream_backfill_xact_lock(db, stream_id)
        job2 = get_backfill_job_for_update(db, job_id)
        if job2 is None or job2.status != "CANCELLING":
            db.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="backfill job status changed")
        job2.status = "CANCELLED"
        stage_progress_event(
            db,
            backfill_job_id=int(job2.id),
            stream_id=stream_id,
            event_type="job_cancelled",
            level="INFO",
            message="Backfill job cancelled",
        )
        db.commit()
        coord.clear_job_session(int(job_id))
        db.refresh(job2)
        return job2

    if probe.status == "CANCELLING":
        acquire_stream_backfill_xact_lock(db, stream_id)
        job = get_backfill_job_for_update(db, job_id)
        if job is None or job.status != "CANCELLING":
            db.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="backfill job status changed")
        job.status = "CANCELLED"
        stage_progress_event(
            db,
            backfill_job_id=int(job.id),
            stream_id=stream_id,
            event_type="job_cancelled",
            level="INFO",
            message="Backfill job cancelled",
        )
        db.commit()
        coord.clear_job_session(int(job_id))
        db.refresh(job)
        return job

    if probe.status in ("CANCELLED", "COMPLETED", "FAILED"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"cannot cancel backfill job in status {probe.status}",
        )

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"cannot cancel backfill job in status {probe.status}",
    )
