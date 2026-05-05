"""Checkpoint use-cases — update only after successful delivery."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock
from typing import Any

from sqlalchemy.orm import Session

from app.checkpoints.repository import get_checkpoint_by_stream_id, upsert_checkpoint


class CheckpointService:
    """In-memory checkpoint store with success-only update semantics.

    This skeleton intentionally avoids DB writes in this phase and provides a safe,
    testable checkpoint boundary for StreamRunner.
    """

    _store: dict[int, dict[str, Any]] = {}
    _lock = Lock()

    def get_checkpoint_for_stream(self, stream_id: int) -> dict[str, Any] | None:
        """Return a deep-copied checkpoint payload for a stream."""

        with self._lock:
            checkpoint = self._store.get(stream_id)
            return deepcopy(checkpoint) if checkpoint is not None else None

    def update(self, stream_id: int, last_success_event: dict[str, Any] | None) -> dict[str, Any] | None:
        """Persist checkpoint using only the last successfully delivered event.

        If ``last_success_event`` is ``None``, no checkpoint is updated.
        """

        if last_success_event is None:
            return None

        payload = {
            "last_success_event": deepcopy(last_success_event),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        with self._lock:
            self._store[stream_id] = payload
        return deepcopy(payload)

    def update_after_successful_delivery(self, stream_id: int, last_success_event: dict[str, Any]) -> dict[str, Any]:
        """Backward-compatible alias for success-only checkpoint updates."""

        updated = self.update(stream_id, last_success_event)
        return updated or {}

    def get_checkpoint(self, db: Session, stream_id: int) -> dict[str, Any] | None:
        """Load checkpoint payload from DB."""

        row = get_checkpoint_by_stream_id(db, stream_id)
        if row is None:
            return None
        value = getattr(row, "checkpoint_value_json", None)
        return deepcopy(value) if isinstance(value, dict) else None

    def update_checkpoint_after_success(
        self,
        db: Session,
        stream_id: int,
        checkpoint_type: str,
        checkpoint_value: dict[str, Any],
    ) -> dict[str, Any]:
        """Upsert checkpoint in DB after delivery success."""

        row = upsert_checkpoint(
            db=db,
            stream_id=stream_id,
            checkpoint_type=checkpoint_type,
            checkpoint_value_json=deepcopy(checkpoint_value),
        )
        value = getattr(row, "checkpoint_value_json", None)
        return deepcopy(value) if isinstance(value, dict) else {}
