"""Request/response models for Safe Change preview and apply."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

SafeChangeEntityType = Literal[
    "STREAM_CONFIG",
    "ROUTE_CONFIG",
    "DESTINATION_CONFIG",
    "MAPPING_CONFIG",
]


class SafeChangeIssue(BaseModel):
    code: str
    message: str
    severity: Literal["blocking", "warning"] = "warning"
    path: str | None = None


class SafeChangeFieldChange(BaseModel):
    path: str
    change: Literal["added", "removed", "modified"]
    old: Any = None
    new: Any = None


class SafeChangeAffectedStream(BaseModel):
    id: int
    name: str
    status: str


class SafeChangeAffectedRoute(BaseModel):
    id: int
    stream_id: int
    destination_id: int
    enabled: bool


class SafeChangeAffectedDestination(BaseModel):
    id: int
    name: str


class SafeChangeAffected(BaseModel):
    streams: list[SafeChangeAffectedStream] = Field(default_factory=list)
    routes: list[SafeChangeAffectedRoute] = Field(default_factory=list)
    destinations: list[SafeChangeAffectedDestination] = Field(default_factory=list)


class SafeChangeRecommendation(BaseModel):
    id: str
    label: str


class SafeChangePreviewRequest(BaseModel):
    entity_type: SafeChangeEntityType
    entity_id: int
    proposed: dict[str, Any] = Field(default_factory=dict)
    base_updated_at: datetime | None = None


class SafeChangePreviewResponse(BaseModel):
    entity_type: SafeChangeEntityType
    entity_id: int
    entity_name: str
    current_updated_at: datetime | None = None
    has_changes: bool
    changed_fields: list[SafeChangeFieldChange] = Field(default_factory=list)
    affected: SafeChangeAffected = Field(default_factory=SafeChangeAffected)
    runtime_impact: str
    delivery_impact: str
    blocking_issues: list[SafeChangeIssue] = Field(default_factory=list)
    warnings: list[SafeChangeIssue] = Field(default_factory=list)
    can_apply: bool
    recommended_actions: list[SafeChangeRecommendation] = Field(default_factory=list)
    preview_only: bool = True
    stale_base: bool = False


class SafeChangeApplyRequest(SafeChangePreviewRequest):
    """Apply after preview; persists only when safe and not stale."""


class SafeChangeApplyResponse(BaseModel):
    entity_type: SafeChangeEntityType
    entity_id: int
    applied: bool
    no_op: bool = False
    config_version: int | None = None
    updated_at: datetime | None = None
    preview: SafeChangePreviewResponse
