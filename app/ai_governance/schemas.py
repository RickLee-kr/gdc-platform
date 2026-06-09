"""Pydantic schemas for AI governance API (M24)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AiPolicyViolationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    request_id: str
    stream_id: int | None = None
    ai_provider_id: int | None = None
    ai_stream_id: int | None = None
    policy_rule_id: int | None = None
    provider: str | None = None
    ai_stream: str | None = None
    rule_id: str | None = None
    action: str
    severity: str
    status: str
    operator_note: str | None = None
    acknowledged_at: datetime | None = None
    acknowledged_by: str | None = None
    resolved_at: datetime | None = None
    resolved_by: str | None = None
    created_at: datetime


class AiPolicyViolationListResponse(BaseModel):
    total: int
    violations: list[AiPolicyViolationRead]


class AiGovernanceWorkflowNote(BaseModel):
    note: str | None = None


class AiGovernanceRankedItem(BaseModel):
    key: str
    label: str
    count: int


class AiGovernancePolicyImpact(BaseModel):
    policy_rule_id: int | None = None
    rule_id: str | None = None
    block_count: int = 0
    mask_count: int = 0
    redact_count: int = 0
    total_count: int = 0


class AiGovernanceDashboardSummary(BaseModel):
    window_hours: int
    total_requests: int = 0
    policy_blocks: int = 0
    policy_violations: int = 0
    mask_events: int = 0
    redact_events: int = 0
    open_violations: int = 0
    acknowledged_violations: int = 0
    resolved_violations: int = 0
    top_violated_policies: list[AiGovernanceRankedItem] = Field(default_factory=list)
    top_providers: list[AiGovernanceRankedItem] = Field(default_factory=list)
    top_ai_streams: list[AiGovernanceRankedItem] = Field(default_factory=list)
    policy_impact: list[AiGovernancePolicyImpact] = Field(default_factory=list)
