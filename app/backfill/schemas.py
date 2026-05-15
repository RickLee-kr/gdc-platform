"""Pydantic schemas for backfill job APIs."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

BackfillMode = Literal[
    "CHECKPOINT_REWIND",
    "TIME_RANGE_REPLAY",
    "OBJECT_REPLAY",
    "FILE_REPLAY",
    "INITIAL_FILL",
]

BackfillStatus = Literal["PENDING", "RUNNING", "CANCELLING", "PAUSED", "COMPLETED", "FAILED", "CANCELLED"]


class BackfillProgressEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    backfill_job_id: int
    stream_id: int
    event_type: str
    level: str
    message: str
    progress_json: dict | None
    error_code: str | None
    created_at: datetime


class BackfillJobCreate(BaseModel):
    """Create a backfill job row (foundation only — execution is future work)."""

    stream_id: int = Field(..., ge=1)
    backfill_mode: BackfillMode
    requested_by: str = Field(default="unknown", max_length=256)
    runtime_options_json: dict = Field(default_factory=dict)


class BackfillReplayRequest(BaseModel):
    """Bounded operational replay for one stream (create + execute in one request)."""

    stream_id: int = Field(..., ge=1)
    start_time: datetime
    end_time: datetime
    dry_run: bool = False
    requested_by: str = Field(default="unknown", max_length=256)


class BackfillJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    stream_id: int
    source_type: str
    status: str
    backfill_mode: str
    requested_by: str
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    failed_at: datetime | None
    source_config_snapshot_json: dict
    checkpoint_snapshot_json: dict | None
    runtime_options_json: dict
    progress_json: dict
    error_summary: str | None
    delivery_summary_json: dict | None
