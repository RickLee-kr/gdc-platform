"""Shared enabled-stream context loader for API and standalone scheduler bootstraps.

Keeps scheduler/runtime domain logic out of ``app.main`` so standalone does not
import the FastAPI entrypoint.
"""

from __future__ import annotations

import logging

from app.database import SessionLocal
from app.runners.stream_loader import load_stream_context
from app.streams.repository import get_enabled_stream_ids

logger = logging.getLogger(__name__)


def load_enabled_stream_contexts() -> list[object]:
    """Load enabled stream runtime contexts (boot / streams_provider compatibility)."""

    db = SessionLocal()
    try:
        out: list[object] = []
        for stream_id in get_enabled_stream_ids(db):
            try:
                out.append(load_stream_context(db, stream_id))
            except Exception as exc:  # pragma: no cover - boot guard
                logger.error(
                    "%s",
                    {
                        "stage": "scheduler_stream_context_load_failed",
                        "stream_id": int(stream_id),
                        "error_type": type(exc).__name__,
                        "message": str(exc),
                    },
                )
        return out
    finally:
        db.close()
