"""Sensitive detection M5 — operator acknowledge and summary (M4 pattern)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.sensitive_detection.detection import _confirm_runs, is_api_visible, sensitive_detection_enabled
from app.sensitive_detection.models import (
    FINDING_STATUS_ACKNOWLEDGED,
    FINDING_STATUS_OPEN,
    FINDING_STATUS_RESOLVED,
    SENSITIVITY_CLASS_PII,
    SENSITIVITY_CLASS_SECRET,
    SENSITIVITY_CLASS_SECURITY_METADATA,
    StreamSensitiveFinding,
)

SensitiveStatusFilter = Literal["open", "acknowledged", "all"]

_SENSITIVITY_CLASSES = (
    SENSITIVITY_CLASS_SECRET,
    SENSITIVITY_CLASS_PII,
    SENSITIVITY_CLASS_SECURITY_METADATA,
)


class SensitiveFindingNotFoundError(Exception):
    def __init__(self, finding_id: int) -> None:
        self.finding_id = finding_id
        super().__init__(f"sensitive finding not found: {finding_id}")


class SensitiveFindingStateError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)


def normalize_status_filter(raw: str | None) -> SensitiveStatusFilter:
    if raw is None or raw.strip() == "":
        return "open"
    value = raw.strip().lower()
    if value in ("open", "acknowledged", "all"):
        return value  # type: ignore[return-value]
    raise ValueError(f"invalid status filter: {raw!r}; expected open, acknowledged, or all")


def _finding_entry(finding: StreamSensitiveFinding) -> dict[str, Any]:
    finding_json = finding.finding_json if isinstance(finding.finding_json, dict) else None
    return {
        "id": finding.id,
        "field_path": finding.field_path,
        "sensitivity_class": finding.sensitivity_class,
        "detection_method": finding.detection_method,
        "status": finding.status,
        "confirm_run_count": int(finding.confirm_run_count or 0),
        "first_detected_at": finding.first_detected_at,
        "last_confirmed_at": finding.last_confirmed_at,
        "finding": finding_json,
        "related_drift_finding_id": finding.related_drift_finding_id,
        "operator_note": finding.operator_note,
    }


def list_sensitive_findings(
    db: Session,
    stream_id: int,
    *,
    status_filter: SensitiveStatusFilter = "open",
) -> list[StreamSensitiveFinding]:
    stmt = select(StreamSensitiveFinding).where(StreamSensitiveFinding.stream_id == stream_id)
    if status_filter == "open":
        stmt = stmt.where(StreamSensitiveFinding.status == FINDING_STATUS_OPEN)
    elif status_filter == "acknowledged":
        stmt = stmt.where(StreamSensitiveFinding.status == FINDING_STATUS_ACKNOWLEDGED)
    stmt = stmt.order_by(
        StreamSensitiveFinding.sensitivity_class,
        StreamSensitiveFinding.field_path,
    )
    rows = list(db.execute(stmt).scalars())
    include_resolved = status_filter == "all"
    return [r for r in rows if is_api_visible(r, include_resolved=include_resolved)]


def get_sensitive_findings_read_payload(
    db: Session,
    stream_id: int,
    *,
    status_filter: SensitiveStatusFilter = "open",
) -> dict[str, Any]:
    findings = list_sensitive_findings(db, stream_id, status_filter=status_filter)
    return {
        "stream_id": stream_id,
        "detection_enabled": sensitive_detection_enabled(),
        "status_filter": status_filter,
        "confirm_runs_required": _confirm_runs(),
        "findings": [_finding_entry(f) for f in findings],
        "finding_count": len(findings),
    }


def build_sensitive_summary(db: Session, stream_id: int) -> dict[str, Any]:
    rows = list(
        db.execute(select(StreamSensitiveFinding).where(StreamSensitiveFinding.stream_id == stream_id)).scalars()
    )
    open_count = 0
    acknowledged_count = 0
    resolved_count = 0
    by_class: dict[str, int] = {c: 0 for c in _SENSITIVITY_CLASSES}

    for finding in rows:
        if finding.status == FINDING_STATUS_OPEN and is_api_visible(finding):
            open_count += 1
            if finding.sensitivity_class in by_class:
                by_class[finding.sensitivity_class] += 1
        elif finding.status == FINDING_STATUS_ACKNOWLEDGED and is_api_visible(finding):
            acknowledged_count += 1
        elif finding.status == FINDING_STATUS_RESOLVED:
            resolved_count += 1

    return {
        "stream_id": stream_id,
        "open_count": open_count,
        "acknowledged_count": acknowledged_count,
        "resolved_count": resolved_count,
        "by_class": by_class,
        "detection_enabled": sensitive_detection_enabled(),
        "confirm_runs_required": _confirm_runs(),
    }


def acknowledge_sensitive_finding(
    db: Session,
    *,
    stream_id: int,
    finding_id: int,
    actor_username: str,
    note: str | None = None,
) -> StreamSensitiveFinding:
    finding = db.execute(
        select(StreamSensitiveFinding).where(
            StreamSensitiveFinding.id == finding_id,
            StreamSensitiveFinding.stream_id == stream_id,
        )
    ).scalar_one_or_none()
    if finding is None:
        raise SensitiveFindingNotFoundError(finding_id)
    if finding.status != FINDING_STATUS_OPEN:
        raise SensitiveFindingStateError(
            f"finding {finding_id} cannot be acknowledged from status {finding.status!r}"
        )
    if int(finding.confirm_run_count or 0) < _confirm_runs():
        raise SensitiveFindingStateError(
            f"finding {finding_id} not confirmed ({finding.confirm_run_count} < {_confirm_runs()})"
        )
    now = datetime.now(timezone.utc)
    finding.status = FINDING_STATUS_ACKNOWLEDGED
    finding.acknowledged_at = now
    finding.acknowledged_by = actor_username
    if note is not None and note.strip():
        finding.operator_note = note.strip()
    return finding
