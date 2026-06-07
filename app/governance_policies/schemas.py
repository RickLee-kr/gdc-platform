"""Pydantic schemas for governance policy API."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

PolicyStatus = Literal["DRAFT", "REVIEW", "ACTIVE", "RETIRED"]
PolicyCategory = Literal["DATA_PROTECTION", "AI_GOVERNANCE", "COMPLIANCE", "CUSTOM"]
ConditionOperator = Literal["equals", "not_equals", "contains"]
PolicyActionType = Literal["quarantine", "tokenize", "mask", "audit_only"]


class PolicyCondition(BaseModel):
    field: str = Field(..., min_length=1, max_length=64)
    operator: ConditionOperator
    value: str = Field(..., min_length=1, max_length=256)


class PolicyAction(BaseModel):
    type: PolicyActionType


class PolicyJsonBody(BaseModel):
    conditions: list[PolicyCondition] = Field(default_factory=list)
    actions: list[PolicyAction] = Field(default_factory=list)


class GovernancePolicyCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=2048)
    category: PolicyCategory = "DATA_PROTECTION"
    status: PolicyStatus = "DRAFT"
    policy_json: PolicyJsonBody


class GovernancePolicyUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=2048)
    category: PolicyCategory | None = None
    status: PolicyStatus | None = None
    policy_json: PolicyJsonBody | None = None


class StreamAssignmentEntry(BaseModel):
    stream_id: int
    enabled: bool = True


class GovernancePolicyAssignmentsRequest(BaseModel):
    assignments: list[StreamAssignmentEntry] = Field(default_factory=list)

    @field_validator("assignments")
    @classmethod
    def _unique_stream_ids(cls, value: list[StreamAssignmentEntry]) -> list[StreamAssignmentEntry]:
        seen: set[int] = set()
        for entry in value:
            if entry.stream_id in seen:
                raise ValueError(f"duplicate stream_id in assignments: {entry.stream_id}")
            seen.add(entry.stream_id)
        return value


class GovernancePolicyEntry(BaseModel):
    id: int
    name: str
    description: str | None
    category: str
    status: str
    policy_json: dict[str, Any]
    version: int
    assigned_stream_count: int = 0
    assigned_stream_ids: list[int] = Field(default_factory=list)
    impact_matched_events: int | None = None
    impact_data_available: bool = False
    impact_summary: str | None = None
    activated_at: datetime | None = None
    retired_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class GovernancePolicyListResponse(BaseModel):
    policies: list[GovernancePolicyEntry] = Field(default_factory=list)


class GovernancePolicyResponse(BaseModel):
    policy: GovernancePolicyEntry


class GovernancePolicyAssignmentsResponse(BaseModel):
    policy_id: int
    assignments: list[StreamAssignmentEntry] = Field(default_factory=list)


class PolicyPreviewRuleLine(BaseModel):
    condition_text: str
    action_text: str
    combined: str


class GovernancePolicyPreviewResponse(BaseModel):
    policy_id: int
    policy_json: dict[str, Any]
    rules: list[PolicyPreviewRuleLine] = Field(default_factory=list)
    summary: str = ""


class PolicyImpactStreamEntry(BaseModel):
    stream_id: int
    stream_name: str
    total_events: int = 0
    matched_events: int = 0


class PolicyImpactDelta(BaseModel):
    matched_events_change: int | None = None


class GovernancePolicyImpactResponse(BaseModel):
    window: str = "24h"
    total_events: int = 0
    matched_events: int = 0
    actions: dict[str, int] = Field(default_factory=dict)
    streams: list[PolicyImpactStreamEntry] = Field(default_factory=list)
    delta: PolicyImpactDelta = Field(default_factory=PolicyImpactDelta)
    data_available: bool = False


class GovernancePolicyImpactPreviewRequest(BaseModel):
    policy_json: PolicyJsonBody
    policy_id: int | None = None
    stream_ids: list[int] | None = None


class PolicySimulationEventResult(BaseModel):
    matched: bool
    actions: list[str] = Field(default_factory=list)
    reason: str


class GovernancePolicySimulateResponse(BaseModel):
    events: list[PolicySimulationEventResult] = Field(default_factory=list)


class GovernancePolicySimulateRequest(BaseModel):
    policy_json: PolicyJsonBody
    sample_events: list[dict[str, Any]] = Field(default_factory=list)
    stream_ids: list[int] | None = None


class GovernancePolicySimulateByIdRequest(BaseModel):
    sample_events: list[dict[str, Any]] = Field(default_factory=list)
    stream_ids: list[int] | None = None
