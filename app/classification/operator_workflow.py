"""M13 classification — operator workflow (CRUD + summary)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.classification.levels import _SUPPORTED_RULE_CONDITION_CLASSES, normalize_level
from app.classification.metrics import build_platform_classification_summary, build_stream_classification_summary
from app.classification.models import CLASSIFICATION_LEVELS, StreamClassificationRule

class ClassificationRuleNotFoundError(Exception):
    def __init__(self, rule_id: int) -> None:
        self.rule_id = rule_id
        super().__init__(f"classification rule not found: {rule_id}")


class ClassificationRuleValidationError(Exception):
    pass


def _rule_entry(rule: StreamClassificationRule) -> dict[str, Any]:
    return {
        "id": rule.id,
        "stream_id": rule.stream_id,
        "name": rule.name,
        "enabled": bool(rule.enabled),
        "condition_json": dict(rule.condition_json) if isinstance(rule.condition_json, dict) else {},
        "classification_level": rule.classification_level,
        "created_at": rule.created_at,
        "updated_at": rule.updated_at,
    }


def _validate_condition_json(condition_json: dict[str, Any]) -> None:
    if not isinstance(condition_json, dict):
        raise ClassificationRuleValidationError("condition_json must be an object")
    required = condition_json.get("sensitivity_class")
    if required is None:
        raise ClassificationRuleValidationError("condition_json.sensitivity_class is required")
    if str(required) not in _SUPPORTED_RULE_CONDITION_CLASSES:
        raise ClassificationRuleValidationError(f"unsupported sensitivity_class: {required!r}")


def _validate_classification_level(level: str) -> None:
    normalized = normalize_level(level)
    if normalized is None or normalized not in CLASSIFICATION_LEVELS:
        raise ClassificationRuleValidationError(f"unsupported classification_level: {level!r}")


def list_classification_rules(
    db: Session,
    stream_id: int,
    *,
    enabled_only: bool = False,
) -> list[dict[str, Any]]:
    stmt = select(StreamClassificationRule).where(StreamClassificationRule.stream_id == stream_id)
    if enabled_only:
        stmt = stmt.where(StreamClassificationRule.enabled.is_(True))
    stmt = stmt.order_by(StreamClassificationRule.name, StreamClassificationRule.id)
    rules = list(db.execute(stmt).scalars())
    return [_rule_entry(r) for r in rules]


def build_classification_summary(db: Session, stream_id: int) -> dict[str, Any]:
    return build_stream_classification_summary(db, stream_id)


def build_platform_summary(db: Session) -> dict[str, Any]:
    return build_platform_classification_summary(db)


def create_classification_rule(
    db: Session,
    *,
    stream_id: int,
    name: str,
    enabled: bool,
    condition_json: dict[str, Any],
    classification_level: str,
) -> StreamClassificationRule:
    label = name.strip()
    if not label:
        raise ClassificationRuleValidationError("name is required")
    _validate_condition_json(condition_json)
    level = normalize_level(classification_level)
    if level is None:
        raise ClassificationRuleValidationError(f"unsupported classification_level: {classification_level!r}")
    now = datetime.now(timezone.utc)
    rule = StreamClassificationRule(
        stream_id=stream_id,
        name=label,
        enabled=enabled,
        condition_json=dict(condition_json),
        classification_level=level,
        created_at=now,
        updated_at=now,
    )
    db.add(rule)
    db.flush()
    return rule


def patch_classification_rule(
    db: Session,
    *,
    stream_id: int,
    rule_id: int,
    name: str | None = None,
    enabled: bool | None = None,
    condition_json: dict[str, Any] | None = None,
    classification_level: str | None = None,
) -> StreamClassificationRule:
    rule = db.execute(
        select(StreamClassificationRule).where(
            StreamClassificationRule.id == rule_id,
            StreamClassificationRule.stream_id == stream_id,
        )
    ).scalar_one_or_none()
    if rule is None:
        raise ClassificationRuleNotFoundError(rule_id)
    if name is not None:
        label = name.strip()
        if not label:
            raise ClassificationRuleValidationError("name is required")
        rule.name = label
    if enabled is not None:
        rule.enabled = enabled
    if condition_json is not None:
        _validate_condition_json(condition_json)
        rule.condition_json = dict(condition_json)
    if classification_level is not None:
        level = normalize_level(classification_level)
        if level is None:
            raise ClassificationRuleValidationError(f"unsupported classification_level: {classification_level!r}")
        rule.classification_level = level
    rule.updated_at = datetime.now(timezone.utc)
    return rule
