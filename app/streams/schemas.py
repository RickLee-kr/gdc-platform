"""Pydantic schemas for Stream API."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class StreamBase(BaseModel):
    name: str | None = None
    connector_id: int | None = None
    source_id: int | None = None


class StreamCreate(StreamBase):
    name: str
    connector_id: int
    source_id: int


class StreamUpdate(StreamBase):
    pass


class StreamRead(StreamBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str | None = Field(default=None, description="StreamStatus value when populated")
    created_at: datetime | None = None
    updated_at: datetime | None = None
