"""Pydantic schemas for Connector API."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ConnectorBase(BaseModel):
    """Shared writable fields placeholder."""

    name: str | None = Field(default=None)
    description: str | None = None


class ConnectorCreate(ConnectorBase):
    """Create connector."""

    name: str


class ConnectorUpdate(ConnectorBase):
    """Partial update connector."""

    pass


class ConnectorRead(ConnectorBase):
    """Connector returned to clients."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime | None = None
    updated_at: datetime | None = None
