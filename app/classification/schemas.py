"""API schemas for classification endpoints (M13)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

ClassificationLevel = Literal["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]
RuleSensitivityClass = Literal["secret", "pii", "security_metadata"]


class ClassificationRuleConditionJson(BaseModel):
    sensitivity_class: RuleSensitivityClass


class ClassificationRuleEntry(BaseModel):
    id: int
    stream_id: int
    name: str
    enabled: bool
    condition_json: dict[str, Any]
    classification_level: str
    created_at: datetime
    updated_at: datetime


class StreamClassificationRulesResponse(BaseModel):
    stream_id: int
    rules: list[ClassificationRuleEntry] = Field(default_factory=list)
    rule_count: int = 0


class ClassificationRuleCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    enabled: bool = True
    condition_json: ClassificationRuleConditionJson
    classification_level: ClassificationLevel


class ClassificationRulePatchRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    enabled: bool | None = None
    condition_json: ClassificationRuleConditionJson | None = None
    classification_level: ClassificationLevel | None = None


class ClassificationRuleResponse(BaseModel):
    rule: ClassificationRuleEntry


class StreamClassificationSummaryResponse(BaseModel):
    stream_id: int
    total_rules: int = 0
    public_count: int = 0
    internal_count: int = 0
    confidential_count: int = 0
    restricted_count: int = 0
    last_classified_at: datetime | None = None
    last_classification_level: str | None = None


class PlatformClassificationSummaryResponse(BaseModel):
    total_rules: int = 0
    public_count: int = 0
    internal_count: int = 0
    confidential_count: int = 0
    restricted_count: int = 0
    last_classified_at: datetime | None = None
