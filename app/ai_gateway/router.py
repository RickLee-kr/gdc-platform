"""AI Gateway REST API."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.ai_gateway.schemas import (
    AiGatewayChatRequest,
    AiGatewayChatResponse,
    AiGatewayEvaluateRequest,
    AiGatewayEvaluateResponse,
    AiGatewayPolicyCreateRequest,
    AiGatewayPolicyListResponse,
    AiGatewayPolicyPatchRequest,
    AiGatewayPolicyResponse,
    AiGatewaySummaryResponse,
)
from app.ai_gateway.policy_service import (
    AiGatewayPolicyNotFoundError,
    AiGatewayPolicyValidationError,
    create_gateway_policy,
    list_gateway_policies,
    patch_gateway_policy,
)
from app.ai_gateway.service import AiGatewayBlockedError, build_gateway_summary, evaluate_prompt, policy_entry_for_row
from app.database import get_db, get_db_read_bounded

router = APIRouter()


def _policy_response(row) -> AiGatewayPolicyResponse:
    return AiGatewayPolicyResponse(policy=policy_entry_for_row(row))


@router.get("/policies", response_model=AiGatewayPolicyListResponse)
async def get_ai_gateway_policies(
    db: Session = Depends(get_db_read_bounded),
) -> AiGatewayPolicyListResponse:
    rows = list_gateway_policies(db)
    return AiGatewayPolicyListResponse(policies=[policy_entry_for_row(row) for row in rows])


@router.post("/policies", response_model=AiGatewayPolicyResponse, status_code=201)
async def post_ai_gateway_policy(
    body: AiGatewayPolicyCreateRequest,
    db: Session = Depends(get_db),
) -> AiGatewayPolicyResponse:
    try:
        row = create_gateway_policy(
            db,
            name=body.name,
            enabled=body.enabled,
            condition_json=body.condition_json.model_dump(exclude_none=True),
            action_type=body.action_type,
        )
        db.commit()
    except AiGatewayPolicyValidationError as exc:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail={"error_code": "AI_GATEWAY_POLICY_VALIDATION", "message": str(exc)},
        ) from exc
    return _policy_response(row)


@router.patch("/policies/{policy_id}", response_model=AiGatewayPolicyResponse)
async def patch_ai_gateway_policy(
    policy_id: int,
    body: AiGatewayPolicyPatchRequest,
    db: Session = Depends(get_db),
) -> AiGatewayPolicyResponse:
    condition_json = (
        body.condition_json.model_dump(exclude_none=True) if body.condition_json is not None else None
    )
    try:
        row = patch_gateway_policy(
            db,
            policy_id=policy_id,
            name=body.name,
            enabled=body.enabled,
            condition_json=condition_json,
            action_type=body.action_type,
        )
        db.commit()
    except AiGatewayPolicyNotFoundError as exc:
        db.rollback()
        raise HTTPException(
            status_code=404,
            detail={"error_code": "AI_GATEWAY_POLICY_NOT_FOUND", "message": str(exc)},
        ) from exc
    except AiGatewayPolicyValidationError as exc:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail={"error_code": "AI_GATEWAY_POLICY_VALIDATION", "message": str(exc)},
        ) from exc
    return _policy_response(row)


@router.post("/evaluate", response_model=AiGatewayEvaluateResponse)
async def post_ai_gateway_evaluate(
    body: AiGatewayEvaluateRequest,
    db: Session = Depends(get_db),
) -> AiGatewayEvaluateResponse:
    try:
        result = evaluate_prompt(
            db,
            prompt=body.prompt,
            metadata=body.metadata,
            invoke_provider=False,
        )
    except AiGatewayBlockedError as exc:
        insp = exc.inspection
        gateway = insp.gateway_policy
        raise HTTPException(
            status_code=403,
            detail={
                "error_code": "AI_GATEWAY_BLOCKED",
                "request_id": exc.request_id,
                "classification_level": insp.classification_level,
                "decision": gateway.decision,
                "matched_policy_count": gateway.matched_policy_count,
            },
        ) from exc
    return result


@router.post("/chat", response_model=AiGatewayChatResponse)
async def post_ai_gateway_chat(
    body: AiGatewayChatRequest,
    db: Session = Depends(get_db),
) -> AiGatewayChatResponse:
    try:
        result = evaluate_prompt(
            db,
            prompt=body.prompt,
            metadata=body.metadata,
            invoke_provider=True,
        )
    except AiGatewayBlockedError as exc:
        insp = exc.inspection
        gateway = insp.gateway_policy
        raise HTTPException(
            status_code=403,
            detail={
                "error_code": "AI_GATEWAY_BLOCKED",
                "request_id": exc.request_id,
                "classification_level": insp.classification_level,
                "decision": gateway.decision,
                "matched_policy_count": gateway.matched_policy_count,
            },
        ) from exc
    return result  # type: ignore[return-value]


@router.get("/summary", response_model=AiGatewaySummaryResponse)
async def get_ai_gateway_summary(
    db: Session = Depends(get_db_read_bounded),
) -> AiGatewaySummaryResponse:
    return build_gateway_summary(db)
