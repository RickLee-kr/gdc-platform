"""HTTP routes for connector template materialization."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.connector_templates.errors import MaterializationError
from app.connector_templates.schemas import MaterializeRequest, MaterializeResponse
from app.connector_templates.service import materialize_templates
from app.database import get_db

router = APIRouter()


@router.post("/materialize", response_model=MaterializeResponse, status_code=status.HTTP_201_CREATED)
async def materialize_connector_templates(
    body: MaterializeRequest,
    db: Session = Depends(get_db),
) -> MaterializeResponse:
    """Materialize stream templates from a Connector Module into platform rows."""

    try:
        return materialize_templates(db, body)
    except MaterializationError as exc:
        status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
        if exc.error_code == "CONNECTOR_NOT_FOUND":
            status_code = status.HTTP_404_NOT_FOUND
        raise HTTPException(
            status_code=status_code,
            detail={
                "error_code": exc.error_code,
                "message": exc.message,
                "rule_id": exc.rule_id,
            },
        ) from exc
