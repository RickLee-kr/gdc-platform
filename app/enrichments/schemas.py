"""Pydantic schemas for Enrichment API."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class EnrichmentBase(BaseModel):
    stream_id: int | None = None


class EnrichmentCreate(EnrichmentBase):
    stream_id: int


class EnrichmentUpdate(EnrichmentBase):
    pass


class EnrichmentRead(EnrichmentBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime | None = None
    updated_at: datetime | None = None
