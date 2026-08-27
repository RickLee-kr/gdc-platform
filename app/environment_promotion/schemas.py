"""Request/response models for Environment Promotion preview, export, and apply."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

EnvironmentName = Literal["development", "staging", "production"]
PromotionMode = Literal["additive", "full_restore"]


class PromotionIssue(BaseModel):
    code: str
    message: str
    severity: Literal["blocking", "warning"] = "warning"
    path: str | None = None


class PromotionFieldChange(BaseModel):
    entity_type: str
    entity_name: str
    path: str
    change: Literal["added", "removed", "modified"]
    old: Any = None
    new: Any = None


class PromotionAffectedEntity(BaseModel):
    entity_type: str
    id: int | None = None
    name: str
    status: str | None = None
    action: Literal["create", "compare", "replace"] = "compare"


class PromotionAffected(BaseModel):
    entities: list[PromotionAffectedEntity] = Field(default_factory=list)
    streams: int = 0
    routes: int = 0
    destinations: int = 0
    connectors: int = 0


class PromotionExportRequest(BaseModel):
    """Build a GitOps-ready promotion bundle from the current deployment."""

    source_environment: EnvironmentName
    include_destinations: bool = True
    scope: Literal["workspace"] = "workspace"


class PromotionExportResponse(BaseModel):
    source_environment: EnvironmentName
    bundle: dict[str, Any]
    secrets_excluded: bool = True
    checkpoints_excluded: bool = True
    target_fingerprint: str


class PromotionPreviewRequest(BaseModel):
    source_environment: EnvironmentName
    target_environment: EnvironmentName
    bundle: dict[str, Any]
    mode: PromotionMode = "additive"
    """When set, preview reports stale if current target fingerprint differs."""
    target_fingerprint: str | None = None


class PromotionPreviewResponse(BaseModel):
    source_environment: EnvironmentName
    target_environment: EnvironmentName
    mode: PromotionMode
    target_fingerprint: str
    promotion_token: str
    has_changes: bool
    changed_fields: list[PromotionFieldChange] = Field(default_factory=list)
    affected: PromotionAffected = Field(default_factory=PromotionAffected)
    blocking_issues: list[PromotionIssue] = Field(default_factory=list)
    warnings: list[PromotionIssue] = Field(default_factory=list)
    can_promote: bool
    preview_only: bool = True
    stale_target: bool = False
    secrets_excluded: bool = True
    checkpoints_excluded: bool = True
    import_ok: bool = False
    entity_counts: dict[str, int] = Field(default_factory=dict)


class PromotionApplyRequest(BaseModel):
    source_environment: EnvironmentName
    target_environment: EnvironmentName
    bundle: dict[str, Any]
    mode: PromotionMode = "additive"
    promotion_token: str
    target_fingerprint: str
    confirm: bool = False
    confirm_destructive: bool = False


class PromotionApplyResponse(BaseModel):
    applied: bool
    no_op: bool = False
    source_environment: EnvironmentName
    target_environment: EnvironmentName
    mode: PromotionMode
    created_connector_ids: list[int] = Field(default_factory=list)
    created_stream_ids: list[int] = Field(default_factory=list)
    created_destination_ids: list[int] = Field(default_factory=list)
    redirect_path: str | None = None
    preview: PromotionPreviewResponse
