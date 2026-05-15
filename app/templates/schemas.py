"""Pydantic schemas for template registry and instantiation APIs."""

from typing import Any, Literal

from pydantic import BaseModel, Field


class TemplateInstantiateRequest(BaseModel):
    """Operator input to materialize a template into normal platform rows."""

    connector_name: str = Field(..., min_length=1, max_length=255)
    host: str | None = Field(
        default=None,
        description="HTTP origin (scheme + host). Falls back to template connector_defaults.host when omitted.",
    )
    description: str | None = Field(default=None, max_length=4096)
    stream_name: str | None = Field(default=None, max_length=255)
    credentials: dict[str, Any] = Field(
        default_factory=dict,
        description="Auth and connector secret fields (e.g. bearer_token, user_id, api_key, token_url).",
    )
    destination_id: int | None = Field(default=None, description="When set with create_route, creates a Route row.")
    create_route: bool = True
    redirect_to: Literal["stream_runtime", "connector_detail"] = "stream_runtime"


class TemplateInstantiateResponse(BaseModel):
    """IDs created by instantiation (additive only)."""

    template_id: str
    connector_id: int
    source_id: int
    stream_id: int
    mapping_id: int
    enrichment_id: int
    checkpoint_id: int
    route_id: int | None = None
    redirect_path: str


class TemplateSummary(BaseModel):
    """List view for the template library."""

    template_id: str
    name: str
    category: str
    description: str
    source_type: str
    auth_type: str
    tags: list[str] = Field(default_factory=list)
    included_components: list[str] = Field(default_factory=list)
    recommended_destinations: list[str] = Field(default_factory=list)


class TemplateDefinition(BaseModel):
    """Authoring shape for static JSON templates."""

    template_id: str = Field(..., min_length=1)
    name: str
    category: str
    description: str
    source_type: str = "HTTP_API_POLLING"
    auth_type: str
    tags: list[str] = Field(default_factory=list)
    included_components: list[str] = Field(default_factory=list)
    recommended_destinations: list[str] = Field(default_factory=list)
    connector_defaults: dict[str, Any] = Field(default_factory=dict)
    source_config_overlay: dict[str, Any] = Field(default_factory=dict)
    stream_defaults: dict[str, Any] = Field(default_factory=dict)
    mapping_defaults: dict[str, Any] = Field(default_factory=dict)
    enrichment_defaults: dict[str, Any] = Field(default_factory=dict)
    checkpoint_defaults: dict[str, Any] = Field(default_factory=dict)
    route_suggestions: list[dict[str, Any]] = Field(default_factory=list)
    setup_instructions: list[str] = Field(default_factory=list)
    preview: dict[str, Any] = Field(default_factory=dict)
