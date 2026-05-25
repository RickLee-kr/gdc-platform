"""HTTP routes for static template registry, Template Drafts, and instantiation."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.templates.draft_schemas import (
    TemplateDraftCloneResponse,
    TemplateDraftCreateRequest,
    TemplateDraftDetail,
    TemplateDraftInferencePreviewRequest,
    TemplateDraftInferencePreviewResponse,
    TemplateDraftRequestStructure,
    TemplateDraftSummary,
    TemplateDraftWizardPayload,
)
from app.templates.draft_service import (
    clone_draft,
    create_draft,
    delete_draft,
    get_draft,
    list_drafts,
    preview_inference,
    wizard_payload,
)
from app.templates.registry import list_template_summaries, template_detail_public_dict
from app.templates.schemas import TemplateInstantiateRequest, TemplateInstantiateResponse, TemplateSummary
from app.templates.service import instantiate_template

router = APIRouter()


@router.get("/", response_model=list[TemplateSummary])
async def list_templates() -> list[TemplateSummary]:
    """List integration templates available on this deployment."""

    return list_template_summaries()


@router.get("/drafts", response_model=list[TemplateDraftSummary])
async def list_template_drafts(db: Session = Depends(get_db)) -> list[TemplateDraftSummary]:
    """List operator-saved Template Drafts (not published Source Packs)."""

    return list_drafts(db)


@router.post("/drafts/preview-inference", response_model=TemplateDraftInferencePreviewResponse)
async def post_draft_inference_preview(body: TemplateDraftInferencePreviewRequest) -> TemplateDraftInferencePreviewResponse:
    """Analyze a sample payload and return heuristic mapping/checkpoint candidates."""

    inference = preview_inference(body.model_dump())
    return TemplateDraftInferencePreviewResponse(inference=inference)


@router.post("/drafts", response_model=TemplateDraftDetail, status_code=status.HTTP_201_CREATED)
async def post_create_template_draft(body: TemplateDraftCreateRequest, db: Session = Depends(get_db)) -> TemplateDraftDetail:
    """Persist an operator-approved Template Draft (filesystem artifacts + DB index)."""

    return create_draft(db, body)


@router.get("/drafts/{draft_id}", response_model=TemplateDraftDetail)
async def get_template_draft(draft_id: str, db: Session = Depends(get_db)) -> TemplateDraftDetail:
    found = get_draft(db, draft_id)
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "TEMPLATE_DRAFT_NOT_FOUND", "message": draft_id},
        )
    return found


@router.delete("/drafts/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template_draft(draft_id: str, db: Session = Depends(get_db)) -> None:
    if not delete_draft(db, draft_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "TEMPLATE_DRAFT_NOT_FOUND", "message": draft_id},
        )


@router.post("/drafts/{draft_id}/clone", response_model=TemplateDraftCloneResponse, status_code=status.HTTP_201_CREATED)
async def post_clone_template_draft(draft_id: str, db: Session = Depends(get_db)) -> TemplateDraftCloneResponse:
    cloned = clone_draft(db, draft_id)
    if cloned is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "TEMPLATE_DRAFT_NOT_FOUND", "message": draft_id},
        )
    return TemplateDraftCloneResponse(id=cloned.id, display_name=cloned.display_name)


@router.get("/drafts/{draft_id}/wizard-payload", response_model=TemplateDraftWizardPayload)
async def get_template_draft_wizard_payload(draft_id: str, db: Session = Depends(get_db)) -> TemplateDraftWizardPayload:
    payload = wizard_payload(db, draft_id)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "TEMPLATE_DRAFT_NOT_FOUND", "message": draft_id},
        )
    return payload


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
