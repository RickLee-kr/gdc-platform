"""Pydantic schemas for checkpoint payloads (API optional / internal)."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CheckpointBase(BaseModel):
    stream_id: int | None = None


class CheckpointCreate(CheckpointBase):
    stream_id: int


class CheckpointUpdate(CheckpointBase):
    pass


class CheckpointRead(CheckpointBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    updated_at: datetime | None = None
