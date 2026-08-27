"""HTTP routes for Environment Promotion / GitOps operator workflow."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.environment_promotion.schemas import (
    PromotionApplyRequest,
    PromotionApplyResponse,
    PromotionExportRequest,
    PromotionExportResponse,
    PromotionPreviewRequest,
    PromotionPreviewResponse,
)
from app.environment_promotion.service import (
    PromotionError,
    apply_promotion,
    build_promotion_export,
    preview_promotion,
)

router = APIRouter(prefix="/promotion", tags=["environment-promotion"])


def _http_error(exc: PromotionError) -> HTTPException:
    return HTTPException(
        status_code=exc.http_status,
        detail={"error_code": exc.error_code, "message": exc.message},
    )


@router.post("/export", response_model=PromotionExportResponse)
def post_promotion_export(
    body: PromotionExportRequest,
    db: Session = Depends(get_db),
) -> PromotionExportResponse:
    """Export a GitOps-ready, secret-free, checkpoint-free configuration bundle."""

    try:
        return build_promotion_export(db, body)
    except PromotionError as exc:
        raise _http_error(exc) from exc


@router.post("/preview", response_model=PromotionPreviewResponse)
def post_promotion_preview(
    body: PromotionPreviewRequest,
    db: Session = Depends(get_db),
) -> PromotionPreviewResponse:
    """Read-only promotion impact preview (no persistence, no config version)."""

    try:
        return preview_promotion(db, body)
    except PromotionError as exc:
        raise _http_error(exc) from exc


@router.post("/apply", response_model=PromotionApplyResponse)
def post_promotion_apply(
    body: PromotionApplyRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> PromotionApplyResponse:
    """Apply an approved promotion via the existing backup import persist path."""

    try:
        return apply_promotion(db, body, request=request)
    except PromotionError as exc:
        raise _http_error(exc) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error_code": "PROMOTION_APPLY_FAILED", "message": str(exc)},
        ) from exc
