"""Schemas for Marketplace package Update Impact Preview (read-only)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class UpgradeImpactIssue(BaseModel):
    code: str
    message: str
    severity: Literal["blocking", "warning"] = "warning"
    path: str | None = None


class UpgradeImpactFieldChange(BaseModel):
    path: str
    change: Literal["added", "removed", "modified"]
    old: Any = None
    new: Any = None


class UpgradeImpactAffectedStream(BaseModel):
    id: int
    name: str
    status: str
    pack_version: str | None = None


class UpgradeImpactAffectedRoute(BaseModel):
    id: int
    stream_id: int
    destination_id: int
    enabled: bool


class UpgradeImpactAffectedDestination(BaseModel):
    id: int
    name: str


class UpgradeImpactAffected(BaseModel):
    streams: list[UpgradeImpactAffectedStream] = Field(default_factory=list)
    routes: list[UpgradeImpactAffectedRoute] = Field(default_factory=list)
    destinations: list[UpgradeImpactAffectedDestination] = Field(default_factory=list)
    stream_ids_added: list[str] = Field(default_factory=list)
    stream_ids_removed: list[str] = Field(default_factory=list)
    stream_ids_deprecated: list[str] = Field(default_factory=list)


class UpgradeImpactRecommendation(BaseModel):
    id: str
    label: str


class UpgradeImpactTestResult(BaseModel):
    """Static package validation outcome for Test Before Apply surfaces."""

    status: Literal["PASS", "FAIL", "WARNING", "SKIPPED"] = "SKIPPED"
    summary: str = ""
    checks: list[str] = Field(default_factory=list)


class UpgradeImpactPreviewResponse(BaseModel):
    package_id: str
    current_pack_version: str
    proposed_pack_version: str
    current_digest: str
    proposed_digest: str
    current_updated_at: datetime | None = None
    has_changes: bool
    changed_fields: list[UpgradeImpactFieldChange] = Field(default_factory=list)
    affected: UpgradeImpactAffected = Field(default_factory=UpgradeImpactAffected)
    test: UpgradeImpactTestResult = Field(default_factory=UpgradeImpactTestResult)
    blocking_issues: list[UpgradeImpactIssue] = Field(default_factory=list)
    warnings: list[UpgradeImpactIssue] = Field(default_factory=list)
    can_upgrade: bool
    can_apply: bool = False
    recommended_actions: list[UpgradeImpactRecommendation] = Field(default_factory=list)
    preview_only: bool = True
    stale_base: bool = False
    runtime_impact: str = ""
    delivery_impact: str = ""
    schema_baseline_unchanged: bool = True
    checkpoint_unchanged: bool = True
    stream_config_unchanged: bool = True
