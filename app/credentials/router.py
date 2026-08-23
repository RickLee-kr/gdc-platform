"""Credential HTTP routes — Connected Credential foundation API."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from starlette.status import HTTP_422_UNPROCESSABLE_CONTENT

from app.credentials.models import Credential
from app.credentials.schemas import CredentialCreate, CredentialRead, CredentialUpdate
from app.credentials.service import (
    create_credential,
    delete_credential,
    get_credential_by_id,
    serialize_credential_read,
    update_credential,
)
from app.database import get_db, get_db_read_bounded

router = APIRouter()


@router.get("/", response_model=list[CredentialRead])
async def list_credentials(
    connector_id: int | None = None,
    db: Session = Depends(get_db_read_bounded),
) -> list[CredentialRead]:
    q = db.query(Credential)
    if connector_id is not None:
        q = q.filter(Credential.connector_id == int(connector_id))
    rows = q.order_by(Credential.id.asc()).all()
    return [CredentialRead.model_validate(serialize_credential_read(row)) for row in rows]


@router.post("/", response_model=CredentialRead, status_code=status.HTTP_201_CREATED)
async def post_credential(payload: CredentialCreate, db: Session = Depends(get_db)) -> CredentialRead:
    try:
        row = create_credential(db, payload)
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "CONNECTOR_NOT_FOUND", "message": str(exc)},
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error_code": "INVALID_CREDENTIAL", "message": str(exc)},
        ) from exc
    db.commit()
    db.refresh(row)
    return CredentialRead.model_validate(serialize_credential_read(row))


@router.get("/{credential_id}", response_model=CredentialRead)
async def get_credential(credential_id: int, db: Session = Depends(get_db_read_bounded)) -> CredentialRead:
    row = get_credential_by_id(db, credential_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "CREDENTIAL_NOT_FOUND", "message": f"credential not found: {credential_id}"},
        )
    return CredentialRead.model_validate(serialize_credential_read(row))


@router.put("/{credential_id}", response_model=CredentialRead)
async def put_credential(
    credential_id: int,
    payload: CredentialUpdate,
    db: Session = Depends(get_db),
) -> CredentialRead:
    row = get_credential_by_id(db, credential_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "CREDENTIAL_NOT_FOUND", "message": f"credential not found: {credential_id}"},
        )
    try:
        update_credential(db, row, payload)
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "CONNECTOR_NOT_FOUND", "message": str(exc)},
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error_code": "INVALID_CREDENTIAL", "message": str(exc)},
        ) from exc
    db.commit()
    db.refresh(row)
    return CredentialRead.model_validate(serialize_credential_read(row))


@router.delete("/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_credential(credential_id: int, db: Session = Depends(get_db)) -> None:
    row = get_credential_by_id(db, credential_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "CREDENTIAL_NOT_FOUND", "message": f"credential not found: {credential_id}"},
        )
    try:
        delete_credential(db, row)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error_code": "CREDENTIAL_IN_USE", "message": str(exc)},
        ) from exc
    db.commit()
