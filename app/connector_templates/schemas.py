"""Pydantic schemas for connector template materialization API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class MaterializeRequest(BaseModel):
    """POST /connector-templates/materialize body."""

    connector_id: int = Field(..., ge=1)
    module_id: str = Field(..., min_length=1)
    templates: list[str] = Field(..., min_length=1)


class MaterializedStreamRead(BaseModel):
    """One materialized stream with related row ids."""

    template_id: str
    stream_id: int
    stream_name: str
    mapping_id: int
    enrichment_id: int
    checkpoint_id: int
    stream_type: str
    enabled: bool
    status: str
    config_json: dict[str, Any] = Field(default_factory=dict)
    rate_limit_json: dict[str, Any] = Field(default_factory=dict)


class MaterializeResponse(BaseModel):
    """Materialization outcome."""

    module_id: str
    connector_id: int
    created_streams: list[MaterializedStreamRead]
