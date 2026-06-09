"""AI Provider HTTP routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session
from starlette.status import HTTP_422_UNPROCESSABLE_CONTENT

from app.ai_providers.adapters.registry import get_ai_provider_adapter_registry
from app.ai_providers.models import AiProvider
from app.ai_providers.schemas import (
    AiProviderCreate,
    AiProviderCredentialValidationResult,
    AiProviderHealthResult,
    AiProviderModelsResult,
    AiProviderRead,
    AiProviderUpdate,
    AiTrafficSummary,
)
from app.ai_providers.traffic_metrics import build_ai_traffic_summary
from app.ai_providers.service import (
    create_ai_provider,
    get_ai_provider_by_id,
    provider_runtime_bundle,
    serialize_ai_provider_read,
    update_ai_provider,
)
from app.database import get_db, get_db_read_bounded
from app.platform_admin import journal

router = APIRouter()


@router.get("/", response_model=list[AiProviderRead])
async def list_ai_providers(db: Session = Depends(get_db_read_bounded)) -> list[AiProviderRead]:
    rows = db.query(AiProvider).order_by(AiProvider.id.asc()).all()
    return [AiProviderRead.model_validate(serialize_ai_provider_read(row)) for row in rows]


@router.post("/", response_model=AiProviderRead, status_code=status.HTTP_201_CREATED)
async def post_ai_provider(
    payload: AiProviderCreate,
    request: Request,
    db: Session = Depends(get_db),
) -> AiProviderRead:
    try:
        row = create_ai_provider(db, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error_code": "INVALID_AI_PROVIDER", "message": str(exc)},
        ) from exc
    db.flush()
    journal.record_audit_event(
        db,
        action="AI_PROVIDER_CREATED",
        entity_type="AI_PROVIDER",
        entity_id=int(row.id),
        entity_name=str(row.name),
        details={"provider_type": str(row.provider_type)},
        request=request,
    )
    db.commit()
    db.refresh(row)
    return AiProviderRead.model_validate(serialize_ai_provider_read(row))


@router.get("/{provider_id}", response_model=AiProviderRead)
async def get_ai_provider(provider_id: int, db: Session = Depends(get_db_read_bounded)) -> AiProviderRead:
    row = get_ai_provider_by_id(db, provider_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "AI_PROVIDER_NOT_FOUND", "message": f"provider not found: {provider_id}"},
        )
    return AiProviderRead.model_validate(serialize_ai_provider_read(row))


@router.patch("/{provider_id}", response_model=AiProviderRead)
async def patch_ai_provider(
    provider_id: int,
    payload: AiProviderUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> AiProviderRead:
    row = get_ai_provider_by_id(db, provider_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "AI_PROVIDER_NOT_FOUND", "message": f"provider not found: {provider_id}"},
        )
    try:
        update_ai_provider(db, row, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error_code": "INVALID_AI_PROVIDER", "message": str(exc)},
        ) from exc
    journal.record_audit_event(
        db,
        action="AI_PROVIDER_UPDATED",
        entity_type="AI_PROVIDER",
        entity_id=int(row.id),
        entity_name=str(row.name),
        details={"provider_type": str(row.provider_type)},
        request=request,
    )
    db.commit()
    db.refresh(row)
    return AiProviderRead.model_validate(serialize_ai_provider_read(row))


@router.post("/{provider_id}/health-check", response_model=AiProviderHealthResult)
async def post_ai_provider_health_check(
    provider_id: int,
    db: Session = Depends(get_db_read_bounded),
) -> AiProviderHealthResult:
    row = get_ai_provider_by_id(db, provider_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "AI_PROVIDER_NOT_FOUND", "message": f"provider not found: {provider_id}"},
        )
    adapter = get_ai_provider_adapter_registry().get(str(row.provider_type))
    bundle = provider_runtime_bundle(row)
    result = adapter.health_check(
        bundle,
        dict(row.auth_json or {}),
        timeout_seconds=float(row.timeout_seconds or 120),
    )
    return AiProviderHealthResult(
        ok=bool(result.ok),
        message=str(result.message),
        latency_ms=result.latency_ms,
        http_status=result.http_status,
    )


@router.get("/{provider_id}/models", response_model=AiProviderModelsResult)
async def get_ai_provider_models(
    provider_id: int,
    db: Session = Depends(get_db_read_bounded),
) -> AiProviderModelsResult:
    row = get_ai_provider_by_id(db, provider_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "AI_PROVIDER_NOT_FOUND", "message": f"provider not found: {provider_id}"},
        )
    adapter = get_ai_provider_adapter_registry().get(str(row.provider_type))
    bundle = provider_runtime_bundle(row)
    models = adapter.list_models(
        bundle,
        dict(row.auth_json or {}),
        timeout_seconds=float(row.timeout_seconds or 120),
    )
    return AiProviderModelsResult(models=list(models))


@router.post("/{provider_id}/validate-credentials", response_model=AiProviderCredentialValidationResult)
async def post_ai_provider_validate_credentials(
    provider_id: int,
    db: Session = Depends(get_db_read_bounded),
) -> AiProviderCredentialValidationResult:
    row = get_ai_provider_by_id(db, provider_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "AI_PROVIDER_NOT_FOUND", "message": f"provider not found: {provider_id}"},
        )
    adapter = get_ai_provider_adapter_registry().get(str(row.provider_type))
    bundle = provider_runtime_bundle(row)
    if str(row.provider_type) == "MOCK":
        return AiProviderCredentialValidationResult(status="VALID", message="Mock provider ready", latency_ms=0.0)
    result = adapter.validate_credentials(
        bundle,
        dict(row.auth_json or {}),
        timeout_seconds=float(row.timeout_seconds or 120),
    )
    return AiProviderCredentialValidationResult(
        status="VALID" if result.ok else "INVALID",
        message=str(result.message),
        latency_ms=result.latency_ms,
        http_status=result.http_status,
    )


@router.get("/traffic/summary", response_model=AiTrafficSummary)
async def get_ai_traffic_summary(
    hours: int = Query(default=24, ge=1, le=168),
    stream_id: int | None = Query(default=None),
    db: Session = Depends(get_db_read_bounded),
) -> AiTrafficSummary:
    return AiTrafficSummary.model_validate(build_ai_traffic_summary(db, hours=hours, stream_id=stream_id))
