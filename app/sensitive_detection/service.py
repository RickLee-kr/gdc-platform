"""Service entrypoints for sensitive detection (M5)."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.sensitive_detection.context import (
    SensitiveDetectionContext,
    build_sensitive_detection_context,
)
from app.sensitive_detection.detection import persist_sensitive_hits, sensitive_detection_enabled
from app.sensitive_detection.operator_workflow import (
    get_sensitive_findings_read_payload,
    normalize_status_filter,
)

logger = logging.getLogger(__name__)


def detect_sensitive_fields(
    db: Session,
    *,
    stream_id: int,
    events: list[dict[str, Any]],
    context: SensitiveDetectionContext | None = None,
) -> SensitiveDetectionContext | None:
    """Non-blocking detection on enriched events; logs counts only.

    When ``context`` is supplied, reuses its findings (no re-detection).
    Returns the runtime context for downstream pipeline stages.
    """

    if not events:
        return None
    try:
        ctx = context or build_sensitive_detection_context(stream_id=stream_id, events=events)
        if ctx is None:
            return None
        if not sensitive_detection_enabled():
            return ctx
        counts = persist_sensitive_hits(
            db,
            stream_id=stream_id,
            events=events,
            hits=ctx.findings,
        )
        logger.info(
            "sensitive_detection stream_id=%s paths_scanned=%s hits=%s upserted=%s passes=%s",
            stream_id,
            counts.get("paths_scanned"),
            counts.get("hits"),
            counts.get("upserted"),
            ctx.detection_passes,
        )
        return ctx
    except Exception:
        logger.exception("sensitive_detection_failed stream_id=%s", stream_id)
        return context


def get_sensitive_findings_for_stream(
    db: Session,
    stream_id: int,
    *,
    status_filter: str | None = None,
) -> dict[str, Any]:
    return get_sensitive_findings_read_payload(
        db,
        stream_id,
        status_filter=normalize_status_filter(status_filter),
    )
