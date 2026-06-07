"""Pydantic schemas for AI Gateway API."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

GatewayActionType = Literal["allow", "audit", "block", "quarantine"]
GatewaySensitivityClass = Literal["secret", "pii", "security_metadata"]
GatewayClassificationLevel = Literal["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]


class AiGatewayPolicyConditionJson(BaseModel):
    sensitivity_class: GatewaySensitivityClass | None = None
    classification_level: GatewayClassificationLevel | None = None

    @model_validator(mode="after")
    def _require_condition(self) -> AiGatewayPolicyConditionJson:
        if self.sensitivity_class is None and self.classification_level is None:
            raise ValueError("sensitivity_class or classification_level is required")
        return self


class AiGatewayPolicyCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    enabled: bool = True
    condition_json: AiGatewayPolicyConditionJson
    action_type: GatewayActionType


class AiGatewayPolicyPatchRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    enabled: bool | None = None
    condition_json: AiGatewayPolicyConditionJson | None = None
    action_type: GatewayActionType | None = None


class AiGatewayEvaluateRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AiGatewayChatRequest(AiGatewayEvaluateRequest):
    pass


class AiGatewayPolicyEntry(BaseModel):
    id: int
    name: str
    enabled: bool
    condition_json: dict[str, Any]
    action_type: str
    condition_summary: str = ""
    created_at: datetime
    updated_at: datetime


class AiGatewayPolicyListResponse(BaseModel):
    policies: list[AiGatewayPolicyEntry] = Field(default_factory=list)


class AiGatewayPolicyResponse(BaseModel):
    policy: AiGatewayPolicyEntry


class AiGatewayEvaluateResponse(BaseModel):
    request_id: str
    classification_level: str
    decision: str
    matched_policy_count: int
    sensitivity_classes: list[str] = Field(default_factory=list)
    finding_count: int = 0
    protection_applied: bool = False
    processing_time_ms: int = 0
    provider_called: bool = False
    provider_response: dict[str, Any] | None = None
    quarantine_event_id: int | None = None


class AiGatewayChatResponse(AiGatewayEvaluateResponse):
    pass


class AiGatewayRequestEntry(BaseModel):
    request_id: str
    stream_id: int | None
    classification_level: str
    decision: str
    provider: str
    processing_time_ms: int
    matched_policy_count: int
    created_at: datetime


class AiGatewaySummaryResponse(BaseModel):
    allow_count: int = 0
    audit_count: int = 0
    block_count: int = 0
    quarantine_count: int = 0
    avg_processing_time_ms: float = 0.0
    recent_requests: list[AiGatewayRequestEntry] = Field(default_factory=list)
    policies: list[AiGatewayPolicyEntry] = Field(default_factory=list)
