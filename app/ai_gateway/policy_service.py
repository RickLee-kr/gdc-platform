"""AI Gateway policy operator workflow (CRUD)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai_gateway.models import GATEWAY_ACTION_TYPES, AiGatewayPolicy
from app.ai_gateway.policy_engine import (
    _SUPPORTED_CLASSIFICATION_LEVELS,
    _SUPPORTED_CONDITION_CLASSES,
)
from app.classification.levels import normalize_level


class AiGatewayPolicyNotFoundError(Exception):
    def __init__(self, policy_id: int) -> None:
        self.policy_id = policy_id
        super().__init__(f"ai gateway policy not found: {policy_id}")


class AiGatewayPolicyValidationError(Exception):
    pass


def _validate_condition_json(condition_json: dict[str, Any]) -> None:
    if not isinstance(condition_json, dict):
        raise AiGatewayPolicyValidationError("condition_json must be an object")
    sensitivity = condition_json.get("sensitivity_class")
    classification = condition_json.get("classification_level")
    if sensitivity is None and classification is None:
        raise AiGatewayPolicyValidationError(
            "condition_json requires sensitivity_class or classification_level"
        )
    if sensitivity is not None and str(sensitivity) not in _SUPPORTED_CONDITION_CLASSES:
        raise AiGatewayPolicyValidationError(f"unsupported sensitivity_class: {sensitivity!r}")
    if classification is not None:
        normalized = normalize_level(str(classification))
        if normalized is None or normalized not in _SUPPORTED_CLASSIFICATION_LEVELS:
            raise AiGatewayPolicyValidationError(
                f"unsupported classification_level: {classification!r}"
            )


def _validate_action_type(action_type: str) -> None:
    if action_type not in GATEWAY_ACTION_TYPES:
        raise AiGatewayPolicyValidationError(f"unsupported action_type: {action_type!r}")


def list_gateway_policies(db: Session) -> list[AiGatewayPolicy]:
    return list(
        db.execute(select(AiGatewayPolicy).order_by(AiGatewayPolicy.id)).scalars()
    )


def get_gateway_policy(db: Session, policy_id: int) -> AiGatewayPolicy | None:
    return db.get(AiGatewayPolicy, policy_id)


def create_gateway_policy(
    db: Session,
    *,
    name: str,
    enabled: bool,
    condition_json: dict[str, Any],
    action_type: str,
) -> AiGatewayPolicy:
    label = name.strip()
    if not label:
        raise AiGatewayPolicyValidationError("name is required")
    _validate_condition_json(condition_json)
    _validate_action_type(action_type)
    now = datetime.now(timezone.utc)
    row = AiGatewayPolicy(
        name=label,
        enabled=enabled,
        condition_json=dict(condition_json),
        action_type=action_type,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.flush()
    return row


def patch_gateway_policy(
    db: Session,
    *,
    policy_id: int,
    name: str | None = None,
    enabled: bool | None = None,
    condition_json: dict[str, Any] | None = None,
    action_type: str | None = None,
) -> AiGatewayPolicy:
    row = get_gateway_policy(db, policy_id)
    if row is None:
        raise AiGatewayPolicyNotFoundError(policy_id)
    if name is not None:
        label = name.strip()
        if not label:
            raise AiGatewayPolicyValidationError("name is required")
        row.name = label
    if enabled is not None:
        row.enabled = enabled
    if condition_json is not None:
        _validate_condition_json(condition_json)
        row.condition_json = dict(condition_json)
    if action_type is not None:
        _validate_action_type(action_type)
        row.action_type = action_type
    row.updated_at = datetime.now(timezone.utc)
    db.flush()
    return row


def format_condition_summary(condition_json: dict[str, Any]) -> str:
    if not isinstance(condition_json, dict):
        return "—"
    level = condition_json.get("classification_level")
    if level is not None:
        return f"classification_level={level}"
    sensitivity = condition_json.get("sensitivity_class")
    if sensitivity is not None:
        return f"sensitivity_class={sensitivity}"
    return "—"
