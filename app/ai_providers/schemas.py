"""Pydantic schemas for AI Provider API."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

AiProviderTypeLiteral = Literal[
    "OPENAI",
    "AZURE_OPENAI",
    "CLAUDE",
    "GEMINI",
    "OLLAMA",
    "VLLM",
    "MOCK",
]

OPENAI_MODELS = ("gpt-4o", "gpt-4.1", "gpt-4.1-mini")


class AiProviderBase(BaseModel):
    name: str | None = None
    provider_type: AiProviderTypeLiteral | None = None
    enabled: bool | None = None
    endpoint_url: str | None = None
    default_model: str | None = None
    timeout_seconds: int | None = Field(default=None, ge=1, le=300)
    auth_json: dict[str, Any] | None = None


class AiProviderCreate(AiProviderBase):
    name: str
    provider_type: AiProviderTypeLiteral
    endpoint_url: str
    enabled: bool = True
    timeout_seconds: int = 120


class AiProviderUpdate(AiProviderBase):
    pass


class AiProviderRead(AiProviderBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    provider_type: AiProviderTypeLiteral
    enabled: bool
    endpoint_url: str
    default_model: str | None
    timeout_seconds: int
    auth_json: dict[str, Any]
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AiProviderHealthResult(BaseModel):
    ok: bool
    message: str
    latency_ms: float | None = None
    http_status: int | None = None


class AiProviderModelsResult(BaseModel):
    models: list[str]


class AiProviderCredentialValidationResult(BaseModel):
    status: Literal["VALID", "INVALID"]
    message: str
    latency_ms: float | None = None
    http_status: int | None = None


class AiProviderTrafficMetric(BaseModel):
    provider_id: int
    request_count: int
    success_count: int
    failure_count: int
    avg_latency_ms: int


class AiTrafficSummary(BaseModel):
    window_hours: int
    stream_id: int | None = None
    requests: int
    success_count: int
    failure_count: int
    success_rate: float
    error_rate: float
    avg_latency_ms: int
    top_providers: list[AiProviderTrafficMetric]
    failover_count: int
    replay_count: int
    inspected_count: int = 0
    blocked_count: int = 0
    masked_count: int = 0
    redacted_count: int = 0
    policy_blocks: int = 0
    prompt_masks: int = 0
    response_masks: int = 0
