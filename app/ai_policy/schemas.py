"""Pydantic schemas for AI policy rules."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.ai_policy.models import (
    AI_POLICY_ACTION_TYPES,
    AI_POLICY_INSPECTION_TYPES,
    AI_POLICY_TARGETS,
)


class AiPolicyRuleBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    enabled: bool = True
    target: str
    inspection_type: str
    condition_json: dict[str, Any] = Field(default_factory=dict)
    action_type: str


class AiPolicyRuleCreate(AiPolicyRuleBase):
    ai_stream_id: int


class AiPolicyRuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    enabled: bool | None = None
    target: str | None = None
    inspection_type: str | None = None
    condition_json: dict[str, Any] | None = None
    action_type: str | None = None


class AiPolicyRuleRead(AiPolicyRuleBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ai_stream_id: int
    created_at: datetime
    updated_at: datetime


class AiPolicyRuleListQuery(BaseModel):
    ai_stream_id: int | None = None
    target: str | None = None
    enabled_only: bool = False


def supported_targets() -> tuple[str, ...]:
    return AI_POLICY_TARGETS


def supported_inspection_types() -> tuple[str, ...]:
    return AI_POLICY_INSPECTION_TYPES


def supported_action_types() -> tuple[str, ...]:
    return AI_POLICY_ACTION_TYPES
