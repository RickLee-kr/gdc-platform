"""Pydantic schemas for delivery log queries."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DeliveryLogBase(BaseModel):
    stage: str | None = Field(default=None, description="source_fetch, mapping, ...")
    level: str | None = None
    message: str | None = None


class DeliveryLogRead(DeliveryLogBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    connector_id: int | None = None
    stream_id: int | None = None
    route_id: int | None = None
    destination_id: int | None = None
    created_at: datetime | None = None
