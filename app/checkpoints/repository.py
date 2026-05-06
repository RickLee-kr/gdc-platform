"""DB repository for checkpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint


def get_checkpoint_by_stream_id(db: Session, stream_id: int) -> Checkpoint | None:
    """Fetch checkpoint row for stream using DB-side filtering."""

    return db.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).first()


def upsert_checkpoint(
    db: Session,
    stream_id: int,
    checkpoint_type: str,
    checkpoint_value_json: dict[str, Any],
) -> Checkpoint:
    """Upsert checkpoint row for stream with JSON value payload."""

    row = get_checkpoint_by_stream_id(db, stream_id)
    if row is None:
        row = Checkpoint(
            stream_id=stream_id,
            checkpoint_type=checkpoint_type,
            checkpoint_value_json=checkpoint_value_json,
        )
    else:
        row.checkpoint_type = checkpoint_type
        row.checkpoint_value_json = checkpoint_value_json
        if hasattr(row, "updated_at"):
            row.updated_at = datetime.now(timezone.utc)

    db.add(row)
    return row
