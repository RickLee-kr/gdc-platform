"""Pydantic schemas for Source API."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SourceBase(BaseModel):
    connector_id: int | None = None
    source_type: str | None = Field(default=None, description="HTTP_API_POLLING, DATABASE_QUERY, ...")
    config_json: dict | None = None
    auth_json: dict | None = None
    credential_id: int | None = Field(
        default=None,
        description="Optional Credential id; when set, runtime prefers Credential over legacy auth_json.",
    )
    enabled: bool | None = None


class SourceCreate(SourceBase):
    connector_id: int
    source_type: str


class SourceUpdate(SourceBase):
    pass


class SourceRead(SourceBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    config_json: dict | None = None
    auth_json: dict | None = None
    credential_id: int | None = None
    enabled: bool | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
