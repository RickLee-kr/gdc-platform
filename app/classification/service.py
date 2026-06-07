"""Service entrypoints for classification engine (M13)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from app.classification.engine import ClassificationBatchResult, classification_enabled, evaluate_batch
from app.sensitive_detection.context import SensitiveDetectionContext, findings_from_context
from app.classification.metrics import (
    build_classification_complete_payload,
    load_cumulative_classification_distribution,
)


def classify_events_for_delivery(
    db: Session | None,
    *,
    stream_id: int,
    enriched_events: list[dict[str, Any]],
    log_fn: Callable[[dict[str, Any]], None] | None = None,
    detection_context: SensitiveDetectionContext | None = None,
    findings: list[dict[str, Any]] | None = None,
) -> ClassificationBatchResult:
    """Classify enriched events in place after sensitive detection, before protection."""

    if not classification_enabled() or not enriched_events:
        return ClassificationBatchResult(duration_ms=0)

    shared_findings = findings if findings is not None else findings_from_context(detection_context)
    result = evaluate_batch(
        db,
        stream_id=stream_id,
        events=enriched_events,
        findings=shared_findings,
    )
    if log_fn is not None and enriched_events:
        cumulative = (
            load_cumulative_classification_distribution(db, stream_id)
            if db is not None
            else None
        )
        payload = build_classification_complete_payload(
            stream_id=stream_id,
            result=result,
            cumulative_distribution=cumulative,
        )
        if shared_findings is not None:
            payload["sensitive_detection_reused"] = True
            payload["sensitive_detection_passes"] = 1
        log_fn(payload)
        if db is not None:
            db.flush()
    return result


def classify_events_for_preview(
    db: Session | None,
    *,
    stream_id: int,
    enriched_events: list[dict[str, Any]],
    detection_context: SensitiveDetectionContext | None = None,
    findings: list[dict[str, Any]] | None = None,
) -> str | None:
    """Return resolved level for preview (no delivery_logs persistence)."""

    if not enriched_events or not classification_enabled():
        return None
    shared_findings = findings if findings is not None else findings_from_context(detection_context)
    result = evaluate_batch(
        db,
        stream_id=stream_id,
        events=enriched_events,
        findings=shared_findings,
    )
    return str(result.classification_level) if result.events_classified else None
