"""M8 policy engine — operator workflow (CRUD + summary)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.classification.levels import normalize_level
from app.classification.models import CLASSIFICATION_LEVELS
from app.protection.models import POLICY_ACTION_AUDIT_ONLY, POLICY_ACTION_TYPES, StreamPolicyRule
from app.sensitive_detection.models import (
    SENSITIVITY_CLASS_PII,
    SENSITIVITY_CLASS_SECRET,
    SENSITIVITY_CLASS_SECURITY_METADATA,
)

_SUPPORTED_CONDITION_CLASSES = frozenset(
    {
        SENSITIVITY_CLASS_SECRET,
        SENSITIVITY_CLASS_PII,
        SENSITIVITY_CLASS_SECURITY_METADATA,
    }
)


class PolicyRuleNotFoundError(Exception):
    def __init__(self, rule_id: int) -> None:
        self.rule_id = rule_id
        super().__init__(f"policy rule not found: {rule_id}")


class PolicyRuleValidationError(Exception):
    pass


def _rule_entry(rule: StreamPolicyRule) -> dict[str, Any]:
    return {
        "id": rule.id,
        "stream_id": rule.stream_id,
        "name": rule.name,
        "enabled": bool(rule.enabled),
        "condition_json": dict(rule.condition_json) if isinstance(rule.condition_json, dict) else {},
        "action_type": rule.action_type,
        "created_at": rule.created_at,
        "updated_at": rule.updated_at,
    }


def _validate_condition_json(condition_json: dict[str, Any]) -> None:
    if not isinstance(condition_json, dict):
        raise PolicyRuleValidationError("condition_json must be an object")
    sensitivity = condition_json.get("sensitivity_class")
    classification = condition_json.get("classification_level")
    if sensitivity is None and classification is None:
        raise PolicyRuleValidationError(
            "condition_json requires sensitivity_class or classification_level"
        )
    if sensitivity is not None and str(sensitivity) not in _SUPPORTED_CONDITION_CLASSES:
        raise PolicyRuleValidationError(f"unsupported sensitivity_class: {sensitivity!r}")
    if classification is not None:
        normalized = normalize_level(str(classification))
        if normalized is None or normalized not in CLASSIFICATION_LEVELS:
            raise PolicyRuleValidationError(f"unsupported classification_level: {classification!r}")


def _validate_action_type(action_type: str) -> None:
    if action_type not in POLICY_ACTION_TYPES:
        raise PolicyRuleValidationError(f"unsupported action_type: {action_type!r}")


def list_policy_rules(
    db: Session,
    stream_id: int,
    *,
    enabled_only: bool = False,
) -> list[dict[str, Any]]:
    stmt = select(StreamPolicyRule).where(StreamPolicyRule.stream_id == stream_id)
    if enabled_only:
        stmt = stmt.where(StreamPolicyRule.enabled.is_(True))
    stmt = stmt.order_by(StreamPolicyRule.name, StreamPolicyRule.id)
    rules = list(db.execute(stmt).scalars())
    return [_rule_entry(r) for r in rules]


def build_policy_summary(db: Session, stream_id: int) -> dict[str, Any]:
    from app.protection.policy_metrics import load_policy_runtime_metrics

    rows = list(
        db.execute(select(StreamPolicyRule).where(StreamPolicyRule.stream_id == stream_id)).scalars()
    )
    enabled_count = sum(1 for r in rows if r.enabled)
    disabled_count = len(rows) - enabled_count
    runtime_metrics = load_policy_runtime_metrics(db, stream_id, total_policies=len(rows))
    return {
        "stream_id": stream_id,
        "total_policies": len(rows),
        "enabled_policy_count": enabled_count,
        "disabled_policy_count": disabled_count,
        "matched_policies": int(runtime_metrics["matched_policies"]),
        "audit_events": int(runtime_metrics["audit_events"]),
        "last_evaluated_at": runtime_metrics.get("last_evaluated_at"),
    }


def create_policy_rule(
    db: Session,
    *,
    stream_id: int,
    name: str,
    enabled: bool,
    condition_json: dict[str, Any],
    action_type: str,
) -> StreamPolicyRule:
    label = name.strip()
    if not label:
        raise PolicyRuleValidationError("name is required")
    _validate_condition_json(condition_json)
    _validate_action_type(action_type)
    now = datetime.now(timezone.utc)
    rule = StreamPolicyRule(
        stream_id=stream_id,
        name=label,
        enabled=enabled,
        condition_json=dict(condition_json),
        action_type=action_type,
        created_at=now,
        updated_at=now,
    )
    db.add(rule)
    db.flush()
    return rule


def patch_policy_rule(
    db: Session,
    *,
    stream_id: int,
    rule_id: int,
    name: str | None = None,
    enabled: bool | None = None,
    condition_json: dict[str, Any] | None = None,
    action_type: str | None = None,
) -> StreamPolicyRule:
    rule = db.execute(
        select(StreamPolicyRule).where(
            StreamPolicyRule.id == rule_id,
            StreamPolicyRule.stream_id == stream_id,
        )
    ).scalar_one_or_none()
    if rule is None:
        raise PolicyRuleNotFoundError(rule_id)
    if name is not None:
        label = name.strip()
        if not label:
            raise PolicyRuleValidationError("name is required")
        rule.name = label
    if enabled is not None:
        rule.enabled = enabled
    if condition_json is not None:
        _validate_condition_json(condition_json)
        rule.condition_json = dict(condition_json)
    if action_type is not None:
        _validate_action_type(action_type)
        rule.action_type = action_type
    rule.updated_at = datetime.now(timezone.utc)
    return rule
