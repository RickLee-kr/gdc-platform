"""CRUD service for AI policy rules."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai_policy.models import (
    AI_POLICY_ACTION_TYPES,
    AI_POLICY_INSPECTION_PII,
    AI_POLICY_INSPECTION_KEYWORD,
    AI_POLICY_INSPECTION_REGEX,
    AI_POLICY_INSPECTION_SECRET_PATTERN,
    AI_POLICY_INSPECTION_SENSITIVE_CONTENT,
    AI_POLICY_INSPECTION_TYPES,
    AI_POLICY_TARGET_PROMPT,
    AI_POLICY_TARGET_RESPONSE,
    AI_POLICY_TARGETS,
    AiPolicyRule,
)
from app.ai_streams.models import AiStream


class AiPolicyRuleNotFoundError(Exception):
    def __init__(self, rule_id: int) -> None:
        self.rule_id = rule_id
        super().__init__(f"ai policy rule not found: {rule_id}")


class AiPolicyRuleValidationError(Exception):
    pass


def _validate_target(target: str) -> None:
    if target not in AI_POLICY_TARGETS:
        raise AiPolicyRuleValidationError(f"unsupported target: {target!r}")


def _validate_inspection_type(inspection_type: str, *, target: str) -> None:
    if inspection_type not in AI_POLICY_INSPECTION_TYPES:
        raise AiPolicyRuleValidationError(f"unsupported inspection_type: {inspection_type!r}")
    prompt_types = {
        AI_POLICY_INSPECTION_REGEX,
        AI_POLICY_INSPECTION_KEYWORD,
        AI_POLICY_INSPECTION_PII,
        AI_POLICY_INSPECTION_SECRET_PATTERN,
    }
    response_types = {
        AI_POLICY_INSPECTION_PII,
        AI_POLICY_INSPECTION_SECRET_PATTERN,
        AI_POLICY_INSPECTION_SENSITIVE_CONTENT,
    }
    if target == AI_POLICY_TARGET_PROMPT and inspection_type not in prompt_types:
        raise AiPolicyRuleValidationError(
            f"inspection_type {inspection_type!r} is not valid for prompt target"
        )
    if target == AI_POLICY_TARGET_RESPONSE and inspection_type not in response_types:
        raise AiPolicyRuleValidationError(
            f"inspection_type {inspection_type!r} is not valid for response target"
        )


def _validate_condition_json(inspection_type: str, condition_json: dict[str, Any]) -> None:
    if not isinstance(condition_json, dict):
        raise AiPolicyRuleValidationError("condition_json must be an object")
    if inspection_type == AI_POLICY_INSPECTION_REGEX:
        pattern = str(condition_json.get("pattern") or "").strip()
        if not pattern:
            raise AiPolicyRuleValidationError("regex rules require condition_json.pattern")
    elif inspection_type == AI_POLICY_INSPECTION_KEYWORD:
        keyword = str(condition_json.get("keyword") or "").strip()
        if not keyword:
            raise AiPolicyRuleValidationError("keyword rules require condition_json.keyword")


def _validate_action_type(action_type: str) -> None:
    if action_type not in AI_POLICY_ACTION_TYPES:
        raise AiPolicyRuleValidationError(f"unsupported action_type: {action_type!r}")


def _ensure_ai_stream(db: Session, ai_stream_id: int) -> AiStream:
    row = db.query(AiStream).filter(AiStream.id == int(ai_stream_id)).first()
    if row is None:
        raise AiPolicyRuleValidationError(f"ai_stream not found: {ai_stream_id}")
    return row


def serialize_rule(row: AiPolicyRule) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "ai_stream_id": int(row.ai_stream_id),
        "name": str(row.name),
        "enabled": bool(row.enabled),
        "target": str(row.target),
        "inspection_type": str(row.inspection_type),
        "condition_json": dict(row.condition_json) if isinstance(row.condition_json, dict) else {},
        "action_type": str(row.action_type),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def list_ai_policy_rules(
    db: Session,
    *,
    ai_stream_id: int | None = None,
    target: str | None = None,
    enabled_only: bool = False,
) -> list[AiPolicyRule]:
    stmt = select(AiPolicyRule).order_by(AiPolicyRule.id.asc())
    if ai_stream_id is not None:
        stmt = stmt.where(AiPolicyRule.ai_stream_id == int(ai_stream_id))
    if target is not None:
        _validate_target(str(target))
        stmt = stmt.where(AiPolicyRule.target == str(target))
    if enabled_only:
        stmt = stmt.where(AiPolicyRule.enabled.is_(True))
    return list(db.execute(stmt).scalars())


def get_ai_policy_rule_by_id(db: Session, rule_id: int) -> AiPolicyRule | None:
    return db.execute(select(AiPolicyRule).where(AiPolicyRule.id == int(rule_id))).scalar_one_or_none()


def create_ai_policy_rule(
    db: Session,
    *,
    ai_stream_id: int,
    name: str,
    enabled: bool,
    target: str,
    inspection_type: str,
    condition_json: dict[str, Any],
    action_type: str,
) -> AiPolicyRule:
    _ensure_ai_stream(db, ai_stream_id)
    label = name.strip()
    if not label:
        raise AiPolicyRuleValidationError("name is required")
    _validate_target(target)
    _validate_inspection_type(inspection_type, target=target)
    _validate_condition_json(inspection_type, condition_json)
    _validate_action_type(action_type)
    now = datetime.now(timezone.utc)
    row = AiPolicyRule(
        ai_stream_id=int(ai_stream_id),
        name=label,
        enabled=bool(enabled),
        target=str(target),
        inspection_type=str(inspection_type),
        condition_json=dict(condition_json or {}),
        action_type=str(action_type),
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.flush()
    return row


def update_ai_policy_rule(
    db: Session,
    row: AiPolicyRule,
    *,
    name: str | None = None,
    enabled: bool | None = None,
    target: str | None = None,
    inspection_type: str | None = None,
    condition_json: dict[str, Any] | None = None,
    action_type: str | None = None,
) -> AiPolicyRule:
    effective_target = str(target if target is not None else row.target)
    effective_inspection = str(inspection_type if inspection_type is not None else row.inspection_type)
    if name is not None:
        label = name.strip()
        if not label:
            raise AiPolicyRuleValidationError("name is required")
        row.name = label
    if enabled is not None:
        row.enabled = bool(enabled)
    if target is not None:
        _validate_target(target)
        row.target = str(target)
    if inspection_type is not None:
        _validate_inspection_type(inspection_type, target=effective_target)
        row.inspection_type = str(inspection_type)
    if condition_json is not None:
        _validate_condition_json(effective_inspection, condition_json)
        row.condition_json = dict(condition_json)
    if action_type is not None:
        _validate_action_type(action_type)
        row.action_type = str(action_type)
    row.updated_at = datetime.now(timezone.utc)
    return row


def delete_ai_policy_rule(db: Session, row: AiPolicyRule) -> None:
    db.delete(row)
