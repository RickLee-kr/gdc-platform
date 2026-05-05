"""Pydantic schemas for Destination API."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class DestinationBase(BaseModel):
    name: str | None = None


class DestinationCreate(DestinationBase):
    name: str


class DestinationUpdate(DestinationBase):
    pass


class DestinationRead(DestinationBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime | None = None
    updated_at: datetime | None = None
