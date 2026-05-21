"""Pydantic schemas for ``/api/v1/retention`` (operational cleanup)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class RetentionPreviewItem(BaseModel):
    table: str
    rows_eligible: int = Field(ge=0)
    oldest_row_timestamp: datetime | None = None
    retention_days: int = Field(ge=1)
    cutoff_utc: datetime
    notes: dict[str, Any] = Field(default_factory=dict)


class RetentionPreviewResponse(BaseModel):
    generated_at_utc: datetime
    policies: dict[str, int]
    tables: list[RetentionPreviewItem]


class RetentionRunRequest(BaseModel):
    dry_run: bool = True
    tables: list[str] | None = Field(
        default=None,
        description="Optional subset of internal table keys; default = all operational targets.",
    )


class RetentionRunOutcomeItem(BaseModel):
    table: str
    status: str
    matched_count: int
    deleted_count: int
    retention_days: int
    cutoff_utc: datetime
    duration_ms: int
    message: str = ""
    notes: dict[str, Any] = Field(default_factory=dict)


class RetentionRunResponse(BaseModel):
    dry_run: bool
    started_at_utc: datetime
    outcomes: list[RetentionRunOutcomeItem]


class RetentionStatusResponse(BaseModel):
    policies: dict[str, int]
    execution_config: dict[str, Any] = Field(default_factory=dict)
    supplement_next_after_utc: datetime | None = None
    last_operational_retention_at: datetime | None = None
    last_audit: dict[str, Any] | None = None


class PartitionStatusItem(BaseModel):
    table_name: str
    partition_name: str
    month_start: str | None = None
    row_count: int | None = None
    is_protected: bool = False
    is_default: bool = False


class PartitionObservabilityResponse(BaseModel):
    generated_at_utc: datetime
    delivery_logs_partitioned: bool
    partition_key: str | None = None
    partitions: list[PartitionStatusItem] = Field(default_factory=list)
    protected_months: list[str] = Field(default_factory=list)
    oldest_partition: str | None = None
    newest_partition: str | None = None
    orphan_partitions: list[str] = Field(default_factory=list)
    retention_days: int
    checkpoint_history_retention_days: int
    archive_plan_notes: dict[str, Any] = Field(default_factory=dict)
    last_maintenance: dict[str, Any] = Field(default_factory=dict)
