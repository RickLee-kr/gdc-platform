"""HTTP routes for Test Before Apply (reuses Safe Change apply path)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db, get_db_read_bounded
from app.safe_change.service import SafeChangeError
from app.test_before_apply.schemas import (
    TestBeforeApplyApplyRequest,
    TestBeforeApplyApplyResponse,
    TestBeforeApplyPreviewRequest,
    TestBeforeApplyPreviewResponse,
)
from app.test_before_apply.service import apply_test_before_apply, preview_test_before_apply

router = APIRouter(prefix="/test-before-apply", tags=["test-before-apply"])


def _http_error(exc: SafeChangeError) -> HTTPException:
    return HTTPException(
        status_code=exc.http_status,
        detail={"error_code": exc.error_code, "message": exc.message},
    )


@router.post("/preview", response_model=TestBeforeApplyPreviewResponse)
async def post_test_before_apply_preview(
    body: TestBeforeApplyPreviewRequest,
    db: Session = Depends(get_db_read_bounded),
) -> TestBeforeApplyPreviewResponse:
    """Read-only Test Before Apply preview (no config version / audit mutation)."""

    try:
        return preview_test_before_apply(db, body)
    except SafeChangeError as exc:
        raise _http_error(exc) from exc


@router.post("/apply", response_model=TestBeforeApplyApplyResponse)
async def post_test_before_apply_apply(
    body: TestBeforeApplyApplyRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> TestBeforeApplyApplyResponse:
    """Apply via existing Safe Change persist/audit/version path."""

    try:
        return apply_test_before_apply(db, body, request=request)
    except SafeChangeError as exc:
        raise _http_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error_code": "INVALID_CONFIG", "message": str(exc)},
        ) from exc
