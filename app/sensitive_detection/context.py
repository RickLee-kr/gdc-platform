"""Runtime sensitive-detection context (M16.1 — single-pass batch sharing)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.sensitive_detection.detection import detect_hits_for_batch, sensitive_detection_enabled


def _finding_classes(findings: list[dict[str, Any]]) -> set[str]:
    classes: set[str] = set()
    for item in findings:
        if not isinstance(item, dict):
            continue
        raw = item.get("sensitivity_class")
        if raw is not None:
            classes.add(str(raw))
    return classes


@dataclass
class SensitiveDetectionContext:
    """Lightweight in-memory detection snapshot for one enriched batch.

    Distinct from DB-persisted ``StreamSensitiveFinding`` rows used for operator workflow.
    """

    stream_id: int
    events: list[dict[str, Any]]
    findings: list[dict[str, Any]]
    findings_by_event: dict[int, list[dict[str, Any]]]
    finding_classes: set[str]
    field_hits: list[dict[str, Any]]
    detected_at: datetime
    detection_passes: int = 1

    @property
    def sensitive_detection_reused(self) -> bool:
        return True


def build_sensitive_detection_context(
    *,
    stream_id: int,
    events: list[dict[str, Any]],
    findings: list[dict[str, Any]] | None = None,
) -> SensitiveDetectionContext | None:
    """Run detection once (unless findings supplied) and build a shareable context."""

    if not events:
        return None
    if findings is None:
        if not sensitive_detection_enabled():
            return None
        findings = detect_hits_for_batch(events)
    finding_classes = _finding_classes(findings)
    findings_by_event = {index: list(findings) for index in range(len(events))}
    return SensitiveDetectionContext(
        stream_id=int(stream_id),
        events=events,
        findings=findings,
        findings_by_event=findings_by_event,
        finding_classes=finding_classes,
        field_hits=list(findings),
        detected_at=datetime.now(timezone.utc),
    )


def findings_from_context(
    context: SensitiveDetectionContext | None,
) -> list[dict[str, Any]] | None:
    if context is None:
        return None
    return context.findings
