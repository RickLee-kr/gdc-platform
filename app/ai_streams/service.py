"""AI Stream CRUD and validation."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.ai_providers.models import AiProvider
from app.ai_streams.models import AiStream
from app.ai_streams.schemas import AiStreamCreate, AiStreamUpdate
from app.streams.models import Stream


def _normalize_slug(value: str) -> str:
    slug = str(value or "").strip().lower()
    if not slug:
        raise ValueError("slug is required")
    return slug


def validate_ai_stream_refs(
    db: Session,
    *,
    stream_id: int,
    provider_id: int,
    slug: str | None = None,
    exclude_id: int | None = None,
) -> None:
    stream = db.query(Stream).filter(Stream.id == int(stream_id)).first()
    if stream is None:
        raise ValueError(f"stream not found: {stream_id}")

    provider = db.query(AiProvider).filter(AiProvider.id == int(provider_id)).first()
    if provider is None:
        raise ValueError(f"provider not found: {provider_id}")

    if slug is not None:
        query = db.query(AiStream).filter(AiStream.slug == _normalize_slug(slug))
        if exclude_id is not None:
            query = query.filter(AiStream.id != int(exclude_id))
        if query.first() is not None:
            raise ValueError(f"slug already exists: {slug}")

    stream_query = db.query(AiStream).filter(AiStream.stream_id == int(stream_id))
    if exclude_id is not None:
        stream_query = stream_query.filter(AiStream.id != int(exclude_id))
    if stream_query.first() is not None:
        raise ValueError(f"ai_stream already exists for stream_id: {stream_id}")


def create_ai_stream(db: Session, payload: AiStreamCreate) -> AiStream:
    slug = _normalize_slug(payload.slug)
    validate_ai_stream_refs(db, stream_id=int(payload.stream_id), provider_id=int(payload.provider_id), slug=slug)
    row = AiStream(
        stream_id=int(payload.stream_id),
        provider_id=int(payload.provider_id),
        slug=slug,
        model=str(payload.model).strip(),
        enabled=bool(payload.enabled),
    )
    db.add(row)
    db.flush()
    return row


def update_ai_stream(db: Session, row: AiStream, payload: AiStreamUpdate) -> AiStream:
    data = payload.model_dump(exclude_unset=True)
    next_stream_id = int(data["stream_id"]) if "stream_id" in data and data["stream_id"] is not None else int(row.stream_id)
    next_provider_id = (
        int(data["provider_id"]) if "provider_id" in data and data["provider_id"] is not None else int(row.provider_id)
    )
    next_slug = _normalize_slug(data["slug"]) if "slug" in data and data["slug"] is not None else str(row.slug)

    validate_ai_stream_refs(
        db,
        stream_id=next_stream_id,
        provider_id=next_provider_id,
        slug=next_slug if "slug" in data else None,
        exclude_id=int(row.id),
    )

    if "stream_id" in data and data["stream_id"] is not None:
        row.stream_id = next_stream_id
    if "provider_id" in data and data["provider_id"] is not None:
        row.provider_id = next_provider_id
    if "slug" in data and data["slug"] is not None:
        row.slug = next_slug
    if "model" in data and data["model"] is not None:
        row.model = str(data["model"]).strip()
    if "enabled" in data and data["enabled"] is not None:
        row.enabled = bool(data["enabled"])
    return row


def serialize_ai_stream_read(row: AiStream) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "stream_id": int(row.stream_id),
        "provider_id": int(row.provider_id),
        "slug": str(row.slug),
        "model": str(row.model),
        "enabled": bool(row.enabled),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def get_ai_stream_by_id(db: Session, ai_stream_id: int) -> AiStream | None:
    return db.query(AiStream).filter(AiStream.id == int(ai_stream_id)).first()


def get_ai_stream_by_slug(db: Session, slug: str) -> AiStream | None:
    normalized = _normalize_slug(slug)
    return db.query(AiStream).filter(AiStream.slug == normalized).first()
