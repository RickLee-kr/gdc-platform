"""Runtime ingest endpoints for push-based sources."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.runners.webhook_receiver import WebhookReceiver, WebhookReceiverError

router = APIRouter()


@router.post("/webhook/{receiver_key}")
async def ingest_webhook(
    receiver_key: str,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Receive an authenticated webhook event batch and run the stream pipeline."""

    body = await request.body()
    try:
        summary = WebhookReceiver().dispatch(
            db,
            receiver_key=receiver_key,
            headers=dict(request.headers),
            body=body,
            content_type=request.headers.get("content-type"),
        )
    except WebhookReceiverError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"error_code": exc.error_code, "message": str(exc)},
        ) from exc
    return {"accepted": True, "summary": summary}
