"""Source HTTP routes."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from starlette.status import HTTP_422_UNPROCESSABLE_CONTENT

from app.connectors.models import Connector
from app.credentials.service import validate_source_credential_ref
from app.database import get_db
from app.security.auth_json_crypto import auth_json_for_storage
from app.security.secrets import mask_secrets, preserve_masked_secrets
from app.sources.models import Source
from app.sources.schemas import SourceCreate, SourceRead, SourceUpdate

router = APIRouter()


def _source_read_masked(row: Source) -> SourceRead:
    item = SourceRead.model_validate(row).model_dump()
    item["config_json"] = mask_secrets(item.get("config_json"))
    item["auth_json"] = mask_secrets(item.get("auth_json"))
    return SourceRead.model_validate(item)


@router.get("/", response_model=list[SourceRead])
async def list_sources(db: Session = Depends(get_db)) -> list[SourceRead]:
    rows = db.query(Source).order_by(Source.id.asc()).all()
    return [_source_read_masked(row) for row in rows]


@router.post(
    "/",
    response_model=SourceRead,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {
            "description": "Referenced connector does not exist (CONNECTOR_NOT_FOUND).",
            "content": {
                "application/json": {
                    "schema": {
                        "type": "object",
                        "properties": {
                            "detail": {
                                "type": "object",
                                "properties": {
                                    "error_code": {"type": "string", "examples": ["CONNECTOR_NOT_FOUND"]},
                                    "message": {"type": "string"},
                                },
                                "required": ["error_code", "message"],
                            }
                        },
                        "required": ["detail"],
                    }
                }
            },
        }
    },
)
async def create_source(payload: SourceCreate, db: Session = Depends(get_db)) -> SourceRead:
    connector = db.query(Connector).filter(Connector.id == payload.connector_id).first()
    if connector is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "CONNECTOR_NOT_FOUND", "message": f"connector not found: {payload.connector_id}"},
        )
    try:
        validate_source_credential_ref(
            db,
            source_connector_id=int(payload.connector_id),
            credential_id=payload.credential_id,
        )
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "CREDENTIAL_NOT_FOUND", "message": str(exc)},
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error_code": "INVALID_CREDENTIAL_REF", "message": str(exc)},
        ) from exc
    row = Source(
        connector_id=payload.connector_id,
        source_type=payload.source_type,
        config_json=dict(payload.config_json or {}),
        auth_json=auth_json_for_storage(dict(payload.auth_json or {})),
        credential_id=payload.credential_id,
        enabled=True if payload.enabled is None else bool(payload.enabled),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _source_read_masked(row)


@router.get("/{source_id}", response_model=SourceRead)
async def get_source(source_id: int, db: Session = Depends(get_db)) -> SourceRead:
    row = db.query(Source).filter(Source.id == source_id).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "SOURCE_NOT_FOUND", "message": f"source not found: {source_id}"},
        )
    return _source_read_masked(row)


@router.put("/{source_id}", response_model=SourceRead)
async def update_source(source_id: int, payload: SourceUpdate, db: Session = Depends(get_db)) -> SourceRead:
    row = db.query(Source).filter(Source.id == source_id).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "SOURCE_NOT_FOUND", "message": f"source not found: {source_id}"},
        )
    update = payload.model_dump(exclude_unset=True)
    if "connector_id" in update:
        connector = db.query(Connector).filter(Connector.id == int(update["connector_id"])).first()
        if connector is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"error_code": "CONNECTOR_NOT_FOUND", "message": f"connector not found: {update['connector_id']}"},
            )
    next_connector_id = int(update["connector_id"]) if "connector_id" in update else int(row.connector_id)
    if "credential_id" in update:
        try:
            validate_source_credential_ref(
                db,
                source_connector_id=next_connector_id,
                credential_id=update["credential_id"],
            )
        except LookupError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"error_code": "CREDENTIAL_NOT_FOUND", "message": str(exc)},
            ) from exc
        except ValueError as exc:
            raise HTTPException(
                status_code=HTTP_422_UNPROCESSABLE_CONTENT,
                detail={"error_code": "INVALID_CREDENTIAL_REF", "message": str(exc)},
            ) from exc
    elif "connector_id" in update and row.credential_id is not None:
        try:
            validate_source_credential_ref(
                db,
                source_connector_id=next_connector_id,
                credential_id=int(row.credential_id),
            )
        except (LookupError, ValueError) as exc:
            raise HTTPException(
                status_code=HTTP_422_UNPROCESSABLE_CONTENT,
                detail={"error_code": "INVALID_CREDENTIAL_REF", "message": str(exc)},
            ) from exc
    if "config_json" in update and update["config_json"] is not None:
        update["config_json"] = preserve_masked_secrets(dict(update["config_json"]), dict(row.config_json or {}))
    if "auth_json" in update and update["auth_json"] is not None:
        merged_auth = preserve_masked_secrets(dict(update["auth_json"]), dict(row.auth_json or {}))
        update["auth_json"] = auth_json_for_storage(merged_auth)
    for key, value in update.items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return _source_read_masked(row)

@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_source(source_id: int, db: Session = Depends(get_db)) -> None:
    row = db.query(Source).filter(Source.id == source_id).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "SOURCE_NOT_FOUND", "message": f"source not found: {source_id}"},
        )
    db.delete(row)
    db.commit()
