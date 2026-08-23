"""Pydantic schemas for Credential API."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class CredentialBase(BaseModel):
    connector_id: int | None = None
    name: str | None = None
    auth_type: str | None = Field(default=None, description="NO_AUTH, BASIC, BEARER, API_KEY, ...")
    auth_json: dict[str, Any] | None = None
    status: str | None = Field(
        default=None,
        description="CONNECTED | EXPIRED | REVOKED | NEEDS_RECONNECT",
    )


class CredentialCreate(CredentialBase):
    connector_id: int
    name: str
    auth_type: str
    auth_json: dict[str, Any] | None = None
    status: str | None = "CONNECTED"


class CredentialUpdate(CredentialBase):
    pass


class CredentialRead(CredentialBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    connector_id: int
    name: str
    auth_type: str
    auth_json: dict[str, Any]
    status: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
