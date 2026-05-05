"""Pydantic schemas for Source API."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SourceBase(BaseModel):
    connector_id: int | None = None
    source_type: str | None = Field(default=None, description="HTTP_API_POLLING, DATABASE_QUERY, ...")


class SourceCreate(SourceBase):
    connector_id: int
    source_type: str


class SourceUpdate(SourceBase):
    pass


class SourceRead(SourceBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime | None = None
    updated_at: datetime | None = None
