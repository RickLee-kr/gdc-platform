"""API schemas for Stream sensitive findings endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class SensitiveFindingEntry(BaseModel):
    id: int
    field_path: str
    sensitivity_class: str
    detection_method: str
    status: str
    confirm_run_count: int
    first_detected_at: datetime
    last_confirmed_at: datetime
    finding: dict[str, Any] | None = None
    related_drift_finding_id: int | None = None
    operator_note: str | None = None


class StreamSensitiveFindingsResponse(BaseModel):
    stream_id: int
    detection_enabled: bool
    status_filter: Literal["open", "acknowledged", "all"] = "open"
    confirm_runs_required: int = 2
    findings: list[SensitiveFindingEntry] = Field(default_factory=list)
    finding_count: int = 0


class SensitiveClassCounts(BaseModel):
    secret: int = 0
    pii: int = 0
    security_metadata: int = 0


class StreamSensitiveFindingsSummaryResponse(BaseModel):
    stream_id: int
    open_count: int = 0
    acknowledged_count: int = 0
    resolved_count: int = 0
    by_class: SensitiveClassCounts
    detection_enabled: bool = False
    confirm_runs_required: int = 2


class SensitiveFindingAcknowledgeRequest(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


class SensitiveFindingAcknowledgeResponse(BaseModel):
    id: int
    stream_id: int
    field_path: str
    sensitivity_class: str
    detection_method: str
    status: str
    acknowledged_at: datetime
    acknowledged_by: str
    operator_note: str | None = None
