"""Pydantic schemas for Template Draft Builder APIs."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

ImportSource = Literal["CURL", "POSTMAN", "API_TEST_SAMPLE"]


class TemplateDraftInferencePreviewRequest(BaseModel):
    sample_payload: Any = Field(..., description="Parsed JSON body or raw JSON string.")
    event_array_hint: str | None = None
    vendor: str | None = None
    product: str | None = None
    source_type: str = "HTTP_API_POLLING"
    approved_event_array_path: str | None = None
    approved_mapping_candidates: list[dict[str, Any]] | None = None


class TemplateDraftInferencePreviewResponse(BaseModel):
    inference: dict[str, Any]


class TemplateDraftRequestStructure(BaseModel):
    method: str = "GET"
    base_url: str | None = None
    endpoint: str | None = None
    query_params: dict[str, str] = Field(default_factory=dict)
    headers_masked: dict[str, str] = Field(default_factory=dict)
    body: Any | None = None
    body_mode: str | None = None


class TemplateDraftCreateRequest(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4096)
    vendor: str | None = Field(default=None, max_length=128)
    product: str | None = Field(default=None, max_length=128)
    use_case: str | None = Field(default=None, max_length=128)
    source_type: str = "HTTP_API_POLLING"
    api_family: str | None = Field(default=None, max_length=64)
    api_version: str | None = Field(default=None, max_length=64)
    auth_type: str | None = Field(default=None, max_length=64)
    import_source: ImportSource
    request_structure: TemplateDraftRequestStructure
    sample_payload: Any | None = None
    approved_inference: dict[str, Any] = Field(
        default_factory=dict,
        description="Operator-approved inference (event array path, mapping/enrichment/checkpoint candidates).",
    )
    connector_draft: dict[str, Any] | None = Field(
        default=None,
        description="Optional curl/postman connector draft for wizard handoff.",
    )
    stream_draft: dict[str, Any] | None = Field(default=None, description="Optional stream draft for wizard handoff.")
    metadata: dict[str, Any] = Field(default_factory=dict)


class TemplateDraftSummary(BaseModel):
    id: str
    display_name: str
    vendor: str | None
    product: str | None
    use_case: str | None
    source_type: str
    api_version: str | None
    auth_type: str | None
    import_source: str
    created_at: datetime
    updated_at: datetime


class TemplateDraftDetail(TemplateDraftSummary):
    description: str | None = None
    api_family: str | None = None
    request_structure: dict[str, Any] = Field(default_factory=dict)
    inference: dict[str, Any] = Field(default_factory=dict)
    mapping_candidate: list[dict[str, Any]] = Field(default_factory=list)
    enrichment_candidate: list[dict[str, Any]] = Field(default_factory=list)
    checkpoint_candidate: dict[str, Any] | None = None
    sample_payload: Any | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    connector_draft: dict[str, Any] | None = None
    stream_draft: dict[str, Any] | None = None
    normalized_event_preview: Any | None = None


class TemplateDraftCloneResponse(BaseModel):
    id: str
    display_name: str


class TemplateDraftWizardPayload(BaseModel):
    connector_draft: dict[str, Any]
    stream_draft: dict[str, Any] | None = None
    redirect_hint: str = "connector_wizard"
