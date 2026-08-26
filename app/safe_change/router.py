"""HTTP routes for Safe Change Management preview/apply."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db, get_db_read_bounded
from app.safe_change.schemas import SafeChangeApplyRequest, SafeChangeApplyResponse, SafeChangePreviewRequest, SafeChangePreviewResponse
from app.safe_change.service import SafeChangeError, apply_safe_change, preview_safe_change

router = APIRouter(prefix="/safe-change", tags=["safe-change"])


def _http_error(exc: SafeChangeError) -> HTTPException:
    return HTTPException(
        status_code=exc.http_status,
        detail={"error_code": exc.error_code, "message": exc.message},
    )


@router.post("/preview", response_model=SafeChangePreviewResponse)
async def post_safe_change_preview(
    body: SafeChangePreviewRequest,
    db: Session = Depends(get_db_read_bounded),
) -> SafeChangePreviewResponse:
    """Read-only impact preview for Stream/Route/Destination/Mapping configuration changes."""

    try:
        return preview_safe_change(db, body)
    except SafeChangeError as exc:
        raise _http_error(exc) from exc


@router.post("/apply", response_model=SafeChangeApplyResponse)
async def post_safe_change_apply(
    body: SafeChangeApplyRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> SafeChangeApplyResponse:
    """Apply a previously previewed change using existing config version/audit persist paths."""

    try:
        return apply_safe_change(db, body, request=request)
    except SafeChangeError as exc:
        raise _http_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error_code": "INVALID_CONFIG", "message": str(exc)},
        ) from exc
