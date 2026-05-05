"""Pydantic schemas for Route API."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class RouteBase(BaseModel):
    stream_id: int | None = None
    destination_id: int | None = None


class RouteCreate(RouteBase):
    stream_id: int
    destination_id: int


class RouteUpdate(RouteBase):
    pass


class RouteRead(RouteBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime | None = None
    updated_at: datetime | None = None
