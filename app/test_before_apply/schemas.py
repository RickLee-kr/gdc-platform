"""Request/response models for Test Before Apply preview/apply."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.safe_change.schemas import (
    SafeChangeAffected,
    SafeChangeEntityType,
    SafeChangeFieldChange,
    SafeChangeIssue,
    SafeChangeRecommendation,
)

TestBeforeApplyKind = Literal[
    "STREAM_CONFIG",
    "ROUTE_CONFIG",
    "DESTINATION_CONFIG",
    "MAPPING_CONFIG",
]


class TestBeforeApplyTestResult(BaseModel):
    status: Literal["PASS", "FAIL", "WARNING", "SKIPPED"] = "SKIPPED"
    summary: str = ""
    checks: list[str] = Field(default_factory=list)


class TestBeforeApplyEvidence(BaseModel):
    """Optional client-supplied live test evidence (connection/sample)."""

    connection_ok: bool | None = None
    sample_fetched: bool | None = None
    validated: bool | None = None
    tested_at: datetime | None = None
    notes: str | None = None


class TestBeforeApplyPreviewRequest(BaseModel):
    entity_type: TestBeforeApplyKind
    entity_id: int
    proposed: dict[str, Any] = Field(default_factory=dict)
    base_updated_at: datetime | None = None
    test_evidence: TestBeforeApplyEvidence | None = None


class TestBeforeApplyPreviewResponse(BaseModel):
    entity_type: SafeChangeEntityType
    entity_id: int
    entity_name: str
    current_updated_at: datetime | None = None
    has_changes: bool
    changed_fields: list[SafeChangeFieldChange] = Field(default_factory=list)
    affected: SafeChangeAffected = Field(default_factory=SafeChangeAffected)
    test: TestBeforeApplyTestResult = Field(default_factory=TestBeforeApplyTestResult)
    runtime_impact: str
    delivery_impact: str
    blocking_issues: list[SafeChangeIssue] = Field(default_factory=list)
    warnings: list[SafeChangeIssue] = Field(default_factory=list)
    can_apply: bool
    recommended_actions: list[SafeChangeRecommendation] = Field(default_factory=list)
    preview_only: bool = True
    stale_base: bool = False


class TestBeforeApplyApplyRequest(TestBeforeApplyPreviewRequest):
    """Apply after preview; delegates to Safe Change existing apply path."""


class TestBeforeApplyApplyResponse(BaseModel):
    entity_type: SafeChangeEntityType
    entity_id: int
    applied: bool
    no_op: bool = False
    config_version: int | None = None
    updated_at: datetime | None = None
    preview: TestBeforeApplyPreviewResponse
