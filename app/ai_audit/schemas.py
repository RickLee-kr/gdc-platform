"""Pydantic schemas for AI audit API (M23)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AiAuditEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    stream_id: int | None = None
    ai_provider_id: int | None = None
    ai_stream_id: int | None = None
    request_id: str
    event_type: str
    policy_rule_id: int | None = None
    action: str
    matched_rule: str | None = None
    matched_pattern: str | None = None
    provider: str | None = None
    model: str | None = None
    created_at: datetime


class AiAuditEventListResponse(BaseModel):
    total: int
    events: list[AiAuditEventRead]


class AiAuditDeliveryLogRef(BaseModel):
    id: int
    stage: str
    level: str
    message: str
    created_at: datetime
    stream_id: int | None = None
    destination_id: int | None = None


class AiAuditCorrelationResponse(BaseModel):
    request_id: str
    stream_id: int | None = None
    ai_stream_id: int | None = None
    ai_provider_id: int | None = None
    provider: str | None = None
    model: str | None = None
    policy_rule_ids: list[int] = Field(default_factory=list)
    events: list[AiAuditEventRead]
    delivery_logs: list[AiAuditDeliveryLogRef]


class AiAuditMetricsBucket(BaseModel):
    inspected_count: int = 0
    blocked_count: int = 0
    masked_count: int = 0
    redacted_count: int = 0
    prompt_mask_count: int = 0
    response_mask_count: int = 0


class AiAuditProviderMetrics(AiAuditMetricsBucket):
    provider_id: int


class AiAuditStreamMetrics(AiAuditMetricsBucket):
    stream_id: int


class AiAuditMetricsSummary(BaseModel):
    window_hours: int
    totals: AiAuditMetricsBucket
    by_provider: list[AiAuditProviderMetrics]
    by_stream: list[AiAuditStreamMetrics]
