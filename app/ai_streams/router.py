"""AI Stream HTTP routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from starlette.status import HTTP_422_UNPROCESSABLE_CONTENT

from app.ai_streams.models import AiStream
from app.ai_streams.schemas import AiStreamCreate, AiStreamRead, AiStreamUpdate
from app.ai_streams.service import (
    create_ai_stream,
    get_ai_stream_by_id,
    serialize_ai_stream_read,
    update_ai_stream,
)
from app.database import get_db, get_db_read_bounded
from app.platform_admin import journal

router = APIRouter()


@router.get("/", response_model=list[AiStreamRead])
async def list_ai_streams(db: Session = Depends(get_db_read_bounded)) -> list[AiStreamRead]:
    rows = db.query(AiStream).order_by(AiStream.id.asc()).all()
    return [AiStreamRead.model_validate(serialize_ai_stream_read(row)) for row in rows]


@router.post("/", response_model=AiStreamRead, status_code=status.HTTP_201_CREATED)
async def post_ai_stream(
    payload: AiStreamCreate,
    request: Request,
    db: Session = Depends(get_db),
) -> AiStreamRead:
    try:
        row = create_ai_stream(db, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error_code": "INVALID_AI_STREAM", "message": str(exc)},
        ) from exc
    db.flush()
    journal.record_audit_event(
        db,
        action="AI_STREAM_CREATED",
        entity_type="AI_STREAM",
        entity_id=int(row.id),
        entity_name=str(row.slug),
        details={"stream_id": int(row.stream_id), "provider_id": int(row.provider_id)},
        request=request,
    )
    db.commit()
    db.refresh(row)
    return AiStreamRead.model_validate(serialize_ai_stream_read(row))


@router.get("/{ai_stream_id}", response_model=AiStreamRead)
async def get_ai_stream(ai_stream_id: int, db: Session = Depends(get_db_read_bounded)) -> AiStreamRead:
    row = get_ai_stream_by_id(db, ai_stream_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "AI_STREAM_NOT_FOUND", "message": f"ai_stream not found: {ai_stream_id}"},
        )
    return AiStreamRead.model_validate(serialize_ai_stream_read(row))


@router.patch("/{ai_stream_id}", response_model=AiStreamRead)
async def patch_ai_stream(
    ai_stream_id: int,
    payload: AiStreamUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> AiStreamRead:
    row = get_ai_stream_by_id(db, ai_stream_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "AI_STREAM_NOT_FOUND", "message": f"ai_stream not found: {ai_stream_id}"},
        )
    try:
        update_ai_stream(db, row, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error_code": "INVALID_AI_STREAM", "message": str(exc)},
        ) from exc
    journal.record_audit_event(
        db,
        action="AI_STREAM_UPDATED",
        entity_type="AI_STREAM",
        entity_id=int(row.id),
        entity_name=str(row.slug),
        details={"stream_id": int(row.stream_id), "provider_id": int(row.provider_id)},
        request=request,
    )
    db.commit()
    db.refresh(row)
    return AiStreamRead.model_validate(serialize_ai_stream_read(row))


@router.delete("/{ai_stream_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ai_stream(
    ai_stream_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> None:
    row = get_ai_stream_by_id(db, ai_stream_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "AI_STREAM_NOT_FOUND", "message": f"ai_stream not found: {ai_stream_id}"},
        )
    journal.record_audit_event(
        db,
        action="AI_STREAM_DELETED",
        entity_type="AI_STREAM",
        entity_id=int(row.id),
        entity_name=str(row.slug),
        details={"stream_id": int(row.stream_id)},
        request=request,
    )
    db.delete(row)
    db.commit()
