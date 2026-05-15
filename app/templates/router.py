"""HTTP routes for static template registry and instantiation."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.templates.registry import list_template_summaries, template_detail_public_dict
from app.templates.schemas import TemplateInstantiateRequest, TemplateInstantiateResponse, TemplateSummary
from app.templates.service import instantiate_template

router = APIRouter()


@router.get("/", response_model=list[TemplateSummary])
async def list_templates() -> list[TemplateSummary]:
    """List integration templates available on this deployment."""

    return list_template_summaries()


@router.get("/{template_id}")
async def get_template_detail(template_id: str) -> dict:
    """Return the full template document for preview."""

    try:
        return template_detail_public_dict(template_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "TEMPLATE_NOT_FOUND", "message": f"template not found: {template_id}"},
        ) from exc


@router.post("/{template_id}/instantiate", response_model=TemplateInstantiateResponse, status_code=status.HTTP_201_CREATED)
async def instantiate_template_route(
    template_id: str,
    body: TemplateInstantiateRequest,
    db: Session = Depends(get_db),
) -> TemplateInstantiateResponse:
    """Create connector/source/stream/mapping/enrichment/checkpoint and optional route."""

    try:
        return instantiate_template(db, template_id, body)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "TEMPLATE_NOT_FOUND", "message": f"template not found: {template_id}"},
        ) from exc
