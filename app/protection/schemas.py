"""API schemas for Stream protection endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

ProtectionMode = Literal["full_mask", "partial_mask", "hash", "tokenization"]
SensitivityClass = Literal["secret", "pii", "security_metadata"]
ResolveResolution = Literal["false_positive", "protection_applied"]


class ProtectionModeCounts(BaseModel):
    full_mask: int = 0
    partial_mask: int = 0
    hash: int = 0
    tokenization: int = 0


class ProtectionClassCounts(BaseModel):
    secret: int = 0
    pii: int = 0
    security_metadata: int = 0


class ProtectionRuleEntry(BaseModel):
    id: int
    stream_id: int
    field_path: str
    sensitivity_class: str
    protection_mode: str
    enabled: bool
    source_finding_id: int | None = None
    created_by: str
    created_at: datetime
    updated_at: datetime
    detection_method: str | None = None
    matched_rule: str | None = None


class StreamProtectionRulesResponse(BaseModel):
    stream_id: int
    protection_enabled: bool
    rules: list[ProtectionRuleEntry] = Field(default_factory=list)
    rule_count: int = 0


class StreamProtectionSummaryResponse(BaseModel):
    stream_id: int
    protection_enabled: bool
    enabled_rule_count: int = 0
    disabled_rule_count: int = 0
    by_mode: ProtectionModeCounts
    by_class: ProtectionClassCounts
    full_mask_count: int = 0
    partial_mask_count: int = 0
    hash_count: int = 0
    tokenization_count: int = 0
    vault_entry_count: int = 0
    total_rules: int = 0
    total_protected_events: int = 0
    total_protected_fields: int = 0
    last_protected_at: datetime | None = None
    protection_rules: int = 0
    protected_events: int = 0
    protected_fields: int = 0


class ProtectionRuleCreateRequest(BaseModel):
    field_path: str = Field(min_length=1, max_length=4096)
    sensitivity_class: SensitivityClass
    protection_mode: ProtectionMode
    source_finding_id: int
    enabled: bool = True


class ProtectionRulePatchRequest(BaseModel):
    protection_mode: ProtectionMode | None = None
    enabled: bool | None = None
    sensitivity_class: SensitivityClass | None = None


class ProtectionRuleResponse(BaseModel):
    rule: ProtectionRuleEntry


class SensitiveFindingResolveRequest(BaseModel):
    resolution: ResolveResolution
    note: str | None = Field(default=None, max_length=2000)


class SensitiveFindingResolveResponse(BaseModel):
    id: int
    stream_id: int
    field_path: str
    sensitivity_class: str
    detection_method: str
    status: str
    resolution: str | None = None
    resolved_at: datetime | None = None
    resolved_by: str | None = None
    operator_note: str | None = None
    finding: dict[str, Any] | None = None


class IdentityVaultSummaryResponse(BaseModel):
    """GET /runtime/protection/vault/summary — global vault stats (read-only)."""

    vault_entries: int = 0
    stream_count: int = 0
    last_created_at: datetime | None = None
