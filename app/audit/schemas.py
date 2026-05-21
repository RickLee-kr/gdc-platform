"""Pydantic schemas for audit log read APIs."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    actor_user_id: int | None = None
    actor_username: str | None = None
    action: str
    entity_type: str | None = None
    entity_id: int | None = None
    result: str
    ip_address: str | None = None
    user_agent: str | None = None
    metadata_json: dict = Field(default_factory=dict)
    summary: str | None = None


class AuditLogListResponse(BaseModel):
    total: int
    items: list[AuditLogRead]
