"""Stream HTTP routes — includes start/stop (execution is always stream-scoped)."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.connectors.models import Connector
from app.database import get_db, get_db_read_bounded
from app.sources.models import Source
from app.streams import repository as streams_repository
from app.streams.delete_scope import delete_stream_and_dependencies
from app.streams.models import Stream
from app.platform_admin import journal
from app.platform_admin.config_entity_snapshots import serialize_stream_config
from app.streams.schemas import StreamCreate, StreamRead, StreamUpdate

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/", response_model=list[StreamRead])
async def list_streams(db: Session = Depends(get_db_read_bounded)) -> list[StreamRead]:
    """List streams from DB (read-only)."""

    rows = streams_repository.list_streams(db)
    out: list[StreamRead] = []
    for row in rows:
        try:
            out.append(StreamRead.model_validate(row))
        except Exception:
            logger.exception("streams_list_row_skipped stream_id=%s", getattr(row, "id", None))
    return out


@router.post("/", response_model=StreamRead, status_code=status.HTTP_201_CREATED)
async def create_stream(payload: StreamCreate, db: Session = Depends(get_db)) -> StreamRead:
    connector = db.query(Connector).filter(Connector.id == payload.connector_id).first()
    if connector is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "CONNECTOR_NOT_FOUND", "message": f"connector not found: {payload.connector_id}"},
        )

    source = db.query(Source).filter(Source.id == payload.source_id).first()
    if source is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "SOURCE_NOT_FOUND", "message": f"source not found: {payload.source_id}"},
        )

    if int(source.connector_id) != int(payload.connector_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error_code": "SOURCE_CONNECTOR_MISMATCH", "message": "source does not belong to connector"},
        )

    row = Stream(
        name=payload.name,
        connector_id=payload.connector_id,
        source_id=payload.source_id,
        stream_type=payload.stream_type or "HTTP_API_POLLING",
        config_json=dict(payload.config_json or {}),
        polling_interval=int(payload.polling_interval or 60),
        enabled=True if payload.enabled is None else bool(payload.enabled),
        status=payload.status or "STOPPED",
        rate_limit_json=dict(payload.rate_limit_json or {}),
    )
    db.add(row)
    db.flush()
    db.refresh(row)
    journal.record_config_version(
        db,
        entity_type="STREAM_CONFIG",
        entity_id=int(row.id),
        entity_name=str(row.name),
        summary="Stream created",
        snapshot_before=None,
        snapshot_after=serialize_stream_config(row),
    )
    db.commit()
    db.refresh(row)
    return StreamRead.model_validate(row)


@router.get("/{stream_id}", response_model=StreamRead)
async def get_stream(stream_id: int, db: Session = Depends(get_db)) -> StreamRead:
    row = streams_repository.get_stream_by_id(db, stream_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {stream_id}"},
        )
    return StreamRead.model_validate(row)


@router.put("/{stream_id}", response_model=StreamRead)
async def update_stream(stream_id: int, payload: StreamUpdate, db: Session = Depends(get_db)) -> StreamRead:
    row = streams_repository.get_stream_by_id(db, stream_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {stream_id}"},
        )

    update = payload.model_dump(exclude_unset=True)
    if "connector_id" in update:
        connector = db.query(Connector).filter(Connector.id == int(update["connector_id"])).first()
        if connector is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"error_code": "CONNECTOR_NOT_FOUND", "message": f"connector not found: {update['connector_id']}"},
            )

    if "source_id" in update:
        source = db.query(Source).filter(Source.id == int(update["source_id"])).first()
        if source is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"error_code": "SOURCE_NOT_FOUND", "message": f"source not found: {update['source_id']}"},
            )

    connector_id = int(update.get("connector_id", row.connector_id))
    source_id = int(update.get("source_id", row.source_id))
    source = db.query(Source).filter(Source.id == source_id).first()
    if source is None or int(source.connector_id) != connector_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error_code": "SOURCE_CONNECTOR_MISMATCH", "message": "source does not belong to connector"},
        )

    before_snap = serialize_stream_config(row)
    for key, value in update.items():
        setattr(row, key, value)
    after_snap = serialize_stream_config(row)
    journal.record_audit_event(
        db,
        action="STREAM_EDITED",
        actor_username="system",
        entity_type="STREAM",
        entity_id=stream_id,
        entity_name=str(row.name),
        details={"updated_fields": sorted(update.keys())},
    )
    journal.record_config_version(
        db,
        entity_type="STREAM_CONFIG",
        entity_id=stream_id,
        entity_name=str(row.name),
        summary=f"Stream fields: {','.join(sorted(update.keys()))}",
        snapshot_before=before_snap,
        snapshot_after=after_snap,
    )
    db.commit()
    db.refresh(row)
    return StreamRead.model_validate(row)


@router.delete("/{stream_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_stream(stream_id: int, db: Session = Depends(get_db)) -> None:
    row = streams_repository.get_stream_by_id(db, stream_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {stream_id}"},
        )
    if row.status == "RUNNING":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error_code": "STREAM_DELETE_BLOCKED_RUNNING",
                "message": "Stop the stream before deleting it.",
            },
        )
    try:
        delete_stream_and_dependencies(db, stream_id)
    except ValueError as exc:
        if str(exc) == "STREAM_NOT_FOUND":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"error_code": "STREAM_NOT_FOUND", "message": f"stream not found: {stream_id}"},
            ) from exc
        raise


@router.post("/{stream_id}/start")
async def start_stream(stream_id: int) -> dict[str, str]:
    return {"message": f"placeholder start stream {stream_id}"}


@router.post("/{stream_id}/stop")
async def stop_stream(stream_id: int) -> dict[str, str]:
    return {"message": f"placeholder stop stream {stream_id}"}
