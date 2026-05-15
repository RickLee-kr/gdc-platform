"""Pydantic schemas for continuous validation APIs."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

RunRowStatus = Literal["PASS", "FAIL", "WARN"]


class ContinuousValidationCreate(BaseModel):
    """Create a validation definition."""

    name: str = Field(min_length=1, max_length=256)
    validation_type: str = Field(pattern="^(AUTH_ONLY|FETCH_ONLY|FULL_RUNTIME)$")
    target_stream_id: int | None = None
    template_key: str | None = Field(default=None, max_length=64)
    schedule_seconds: int = Field(default=300, ge=10, le=86_400)
    expect_checkpoint_advance: bool = True
    enabled: bool = True


class ContinuousValidationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    enabled: bool
    validation_type: str
    target_stream_id: int | None
    template_key: str | None
    schedule_seconds: int
    expect_checkpoint_advance: bool
    last_run_at: datetime | None
    last_status: str
    last_error: str | None
    consecutive_failures: int
    last_success_at: datetime | None
    last_failing_started_at: datetime | None = None
    last_perf_snapshot_json: str | None = None
    created_at: datetime
    updated_at: datetime


class ContinuousValidationUpdate(BaseModel):
    """Partial update for a validation definition."""

    name: str | None = Field(default=None, min_length=1, max_length=256)
    schedule_seconds: int | None = Field(default=None, ge=10, le=86_400)
    expect_checkpoint_advance: bool | None = None
    target_stream_id: int | None = None
    template_key: str | None = Field(default=None, max_length=64)


class ValidationRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    validation_id: int
    stream_id: int | None
    run_id: str | None
    status: str
    validation_stage: str
    message: str
    latency_ms: int | None
    created_at: datetime


class ValidationRunQuery(BaseModel):
    """Query params for listing validation runs."""

    validation_id: int | None = None
    limit: int = Field(default=100, ge=1, le=500)


class ValidationManualRunResponse(BaseModel):
    """Response for POST .../run."""

    validation_id: int
    stream_id: int | None
    overall_status: RunRowStatus
    run_id: str | None
    latency_ms: int
    message: str


class ValidationAlertRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    validation_id: int
    validation_run_id: int | None
    severity: str
    alert_type: str
    status: str
    title: str
    message: str
    fingerprint: str
    triggered_at: datetime
    acknowledged_at: datetime | None
    resolved_at: datetime | None
    created_at: datetime


class ValidationRecoveryEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    validation_id: int
    validation_run_id: int | None
    category: str
    title: str
    message: str
    created_at: datetime


class ValidationFailuresSummaryResponse(BaseModel):
    """Aggregated validation alert posture for operators."""

    failing_validations_count: int
    degraded_validations_count: int
    open_alerts_critical: int
    open_alerts_warning: int
    open_alerts_info: int
    open_auth_failure_alerts: int
    open_delivery_failure_alerts: int
    open_checkpoint_drift_alerts: int
    latest_open_alerts: list[ValidationAlertRead]


class ValidationOutcomeTrendBucket(BaseModel):
    bucket_start: datetime
    pass_count: int = 0
    fail_count: int = 0
    warn_count: int = 0


class ValidationOperationalSummaryResponse(BaseModel):
    """Dashboard/runtime payload for continuous validation health."""

    failing_validations_count: int
    degraded_validations_count: int
    open_alerts_critical: int
    open_alerts_warning: int
    open_alerts_info: int
    open_auth_failure_alerts: int
    open_delivery_failure_alerts: int
    open_checkpoint_drift_alerts: int
    latest_open_alerts: list[ValidationAlertRead]
    latest_recoveries: list[ValidationRecoveryEventRead]
    outcome_trend_24h: list[ValidationOutcomeTrendBucket]
