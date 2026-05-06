"""DB repository for streams."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.streams.models import Stream


def get_stream_by_id(db: Session, stream_id: int) -> Stream | None:
    """Return stream by primary key."""

    return db.query(Stream).filter(Stream.id == stream_id).first()


def update_stream_status(db: Session, stream_id: int, status: str) -> Stream | None:
    """Update stream status by stream id."""

    stream = get_stream_by_id(db, stream_id)
    if stream is None:
        return None
    stream.status = status
    db.add(stream)
    return stream


def get_enabled_stream_ids(db: Session) -> list[int]:
    """Return enabled stream IDs."""

    rows = db.query(Stream.id).filter(Stream.enabled == True).all()  # noqa: E712
    return [int(row[0]) for row in rows]
