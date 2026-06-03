"""API schemas for Stream observed schema read endpoints."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ObservedFieldEntry(BaseModel):
    path: str
    type: str
    observation_count: int = 0


class StreamObservedSchemaResponse(BaseModel):
    stream_id: int
    observation_enabled: bool
    paths: list[ObservedFieldEntry] = Field(default_factory=list)
    path_count: int = 0
    total_events_observed: int = 0
    observation_run_count: int = 0
    last_observation_at: datetime | None = None
    updated_at: datetime | None = None


class SchemaFieldDriftEntry(BaseModel):
    id: int
    field_path: str
    category: str
    status: str
    first_detected_at: datetime
    last_confirmed_at: datetime


class StreamSchemaFieldDriftsResponse(BaseModel):
    stream_id: int
    drift_detection_enabled: bool
    baseline_established: bool
    baseline_established_at: datetime | None = None
    baseline_path_count: int = 0
    findings: list[SchemaFieldDriftEntry] = Field(default_factory=list)
    finding_count: int = 0
