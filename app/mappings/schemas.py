"""Pydantic schemas for Mapping API."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class MappingBase(BaseModel):
    stream_id: int | None = None


class MappingCreate(MappingBase):
    stream_id: int


class MappingUpdate(MappingBase):
    pass


class MappingRead(MappingBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime | None = None
    updated_at: datetime | None = None
