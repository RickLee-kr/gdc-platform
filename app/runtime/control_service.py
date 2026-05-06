"""Runtime control: stream start/stop; delivery_logs retention cleanup."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.logs.models import DeliveryLog
from app.runtime.schemas import (
    RuntimeLogsCleanupResponse,
    RuntimeStreamControlResponse,
)
from app.streams.models import Stream


class StreamNotFoundError(Exception):
    """Raised when stream_id is missing; router maps to HTTP 404 STREAM_NOT_FOUND."""

    def __init__(self, stream_id: int) -> None:
        super().__init__(stream_id)
        self.stream_id = stream_id


def start_stream(db: Session, stream_id: int) -> RuntimeStreamControlResponse:
    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if stream is None:
        raise StreamNotFoundError(stream_id)
    stream.enabled = True
    stream.status = "RUNNING"
    db.commit()
    db.refresh(stream)
    return RuntimeStreamControlResponse(
        stream_id=int(stream.id),
        enabled=bool(stream.enabled),
        status=str(stream.status),
        action="start",
        message="Stream is enabled and status set to RUNNING.",
    )


def stop_stream(db: Session, stream_id: int) -> RuntimeStreamControlResponse:
    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if stream is None:
        raise StreamNotFoundError(stream_id)
    stream.enabled = False
    stream.status = "STOPPED"
    db.commit()
    db.refresh(stream)
    return RuntimeStreamControlResponse(
        stream_id=int(stream.id),
        enabled=bool(stream.enabled),
        status=str(stream.status),
        action="stop",
        message="Stream is disabled and status set to STOPPED.",
    )


def cleanup_delivery_logs(
    db: Session,
    *,
    older_than_days: int,
    dry_run: bool,
) -> RuntimeLogsCleanupResponse:
    """Delete delivery_logs with created_at before cutoff, or count only when dry_run."""

    cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    flt = DeliveryLog.created_at < cutoff
    matched_count = db.query(DeliveryLog).filter(flt).count()
    deleted_count = 0
    if dry_run:
        message = "Dry run: matched rows were counted; nothing deleted."
    else:
        deleted_count = db.query(DeliveryLog).filter(flt).delete(synchronize_session=False)
        db.commit()
        message = f"Deleted {deleted_count} delivery_logs row(s) with created_at before cutoff."
    return RuntimeLogsCleanupResponse(
        older_than_days=older_than_days,
        dry_run=dry_run,
        cutoff=cutoff,
        matched_count=matched_count,
        deleted_count=deleted_count,
        message=message,
    )
