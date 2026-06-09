"""HTTP routes for AI policy rules (M22)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session
from starlette.status import HTTP_422_UNPROCESSABLE_CONTENT

from app.ai_policy.schemas import AiPolicyRuleCreate, AiPolicyRuleRead, AiPolicyRuleUpdate
from app.ai_policy.service import (
    AiPolicyRuleNotFoundError,
    AiPolicyRuleValidationError,
    create_ai_policy_rule,
    delete_ai_policy_rule,
    get_ai_policy_rule_by_id,
    list_ai_policy_rules,
    serialize_rule,
    update_ai_policy_rule,
)
from app.database import get_db, get_db_read_bounded
from app.platform_admin import journal

router = APIRouter()


@router.get("/", response_model=list[AiPolicyRuleRead])
async def get_ai_policy_rules(
    ai_stream_id: int | None = Query(default=None),
    target: str | None = Query(default=None),
    enabled_only: bool = Query(default=False),
    db: Session = Depends(get_db_read_bounded),
) -> list[AiPolicyRuleRead]:
    try:
        rows = list_ai_policy_rules(
            db,
            ai_stream_id=ai_stream_id,
            target=target,
            enabled_only=enabled_only,
        )
    except AiPolicyRuleValidationError as exc:
        raise HTTPException(
            status_code=HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error_code": "INVALID_AI_POLICY", "message": str(exc)},
        ) from exc
    return [AiPolicyRuleRead.model_validate(serialize_rule(row)) for row in rows]


@router.post("/", response_model=AiPolicyRuleRead, status_code=status.HTTP_201_CREATED)
async def post_ai_policy_rule(
    payload: AiPolicyRuleCreate,
    request: Request,
    db: Session = Depends(get_db),
) -> AiPolicyRuleRead:
    try:
        row = create_ai_policy_rule(
            db,
            ai_stream_id=payload.ai_stream_id,
            name=payload.name,
            enabled=payload.enabled,
            target=payload.target,
            inspection_type=payload.inspection_type,
            condition_json=payload.condition_json,
            action_type=payload.action_type,
        )
    except AiPolicyRuleValidationError as exc:
        raise HTTPException(
            status_code=HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error_code": "INVALID_AI_POLICY", "message": str(exc)},
        ) from exc
    db.flush()
    journal.record_audit_event(
        db,
        action="AI_POLICY_RULE_CREATED",
        entity_type="AI_POLICY_RULE",
        entity_id=int(row.id),
        entity_name=str(row.name),
        details={"ai_stream_id": int(row.ai_stream_id), "target": str(row.target)},
        request=request,
    )
    db.commit()
    db.refresh(row)
    return AiPolicyRuleRead.model_validate(serialize_rule(row))


@router.get("/{rule_id}", response_model=AiPolicyRuleRead)
async def get_ai_policy_rule(rule_id: int, db: Session = Depends(get_db_read_bounded)) -> AiPolicyRuleRead:
    row = get_ai_policy_rule_by_id(db, rule_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "AI_POLICY_RULE_NOT_FOUND", "message": f"rule not found: {rule_id}"},
        )
    return AiPolicyRuleRead.model_validate(serialize_rule(row))


@router.patch("/{rule_id}", response_model=AiPolicyRuleRead)
async def patch_ai_policy_rule(
    rule_id: int,
    payload: AiPolicyRuleUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> AiPolicyRuleRead:
    row = get_ai_policy_rule_by_id(db, rule_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "AI_POLICY_RULE_NOT_FOUND", "message": f"rule not found: {rule_id}"},
        )
    try:
        update_ai_policy_rule(
            db,
            row,
            name=payload.name,
            enabled=payload.enabled,
            target=payload.target,
            inspection_type=payload.inspection_type,
            condition_json=payload.condition_json,
            action_type=payload.action_type,
        )
    except AiPolicyRuleValidationError as exc:
        raise HTTPException(
            status_code=HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error_code": "INVALID_AI_POLICY", "message": str(exc)},
        ) from exc
    journal.record_audit_event(
        db,
        action="AI_POLICY_RULE_UPDATED",
        entity_type="AI_POLICY_RULE",
        entity_id=int(row.id),
        entity_name=str(row.name),
        details={"ai_stream_id": int(row.ai_stream_id)},
        request=request,
    )
    db.commit()
    db.refresh(row)
    return AiPolicyRuleRead.model_validate(serialize_rule(row))


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ai_policy_rule_route(
    rule_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> None:
    row = get_ai_policy_rule_by_id(db, rule_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "AI_POLICY_RULE_NOT_FOUND", "message": f"rule not found: {rule_id}"},
        )
    journal.record_audit_event(
        db,
        action="AI_POLICY_RULE_DELETED",
        entity_type="AI_POLICY_RULE",
        entity_id=int(row.id),
        entity_name=str(row.name),
        details={"ai_stream_id": int(row.ai_stream_id)},
        request=request,
    )
    delete_ai_policy_rule(db, row)
    db.commit()
