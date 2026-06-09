"""Pydantic schemas for AI Stream API."""

from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

_SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")


class AiStreamBase(BaseModel):
    stream_id: int | None = None
    provider_id: int | None = None
    slug: str | None = None
    model: str | None = None
    enabled: bool | None = None


class AiStreamCreate(AiStreamBase):
    stream_id: int
    provider_id: int
    slug: str
    model: str
    enabled: bool = True

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if not normalized or not _SLUG_RE.match(normalized):
            raise ValueError("slug must be 1-64 lowercase alphanumeric characters or hyphens")
        return normalized

    @field_validator("model")
    @classmethod
    def validate_model(cls, value: str) -> str:
        model = str(value or "").strip()
        if not model:
            raise ValueError("model is required")
        return model


class AiStreamUpdate(AiStreamBase):
    @field_validator("slug")
    @classmethod
    def validate_slug(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip().lower()
        if not normalized or not _SLUG_RE.match(normalized):
            raise ValueError("slug must be 1-64 lowercase alphanumeric characters or hyphens")
        return normalized

    @field_validator("model")
    @classmethod
    def validate_model(cls, value: str | None) -> str | None:
        if value is None:
            return None
        model = str(value).strip()
        if not model:
            raise ValueError("model cannot be empty")
        return model


class AiStreamRead(AiStreamBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    stream_id: int
    provider_id: int
    slug: str
    model: str
    enabled: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None
