"""Per-route classification operator workflow (M13.4 P2)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.classification.levels import normalize_level
from app.classification.operator_workflow import (
    ClassificationRuleValidationError,
    _validate_condition_json,
)
from app.route_classification.models import RouteClassificationRule
from app.routes.models import Route
from app.runtime.control_service import RouteNotFoundError


class RouteClassificationRuleNotFoundError(Exception):
    def __init__(self, rule_id: int) -> None:
        self.rule_id = rule_id
        super().__init__(f"route classification rule not found: {rule_id}")


def _load_route(db: Session, route_id: int) -> Route:
    route = db.query(Route).filter(Route.id == route_id).first()
    if route is None:
        raise RouteNotFoundError(route_id)
    return route


def _rule_entry(rule: RouteClassificationRule, *, stream_id: int) -> dict[str, Any]:
    return {
        "id": int(rule.id),
        "route_id": int(rule.route_id),
        "stream_id": stream_id,
        "name": rule.name,
        "enabled": bool(rule.enabled),
        "condition_json": dict(rule.condition_json) if isinstance(rule.condition_json, dict) else {},
        "classification_level": rule.classification_level,
        "created_at": rule.created_at,
        "updated_at": rule.updated_at,
    }


def list_route_classification_rules(
    db: Session,
    route_id: int,
    *,
    enabled_only: bool = False,
) -> tuple[int, list[dict[str, Any]]]:
    route = _load_route(db, route_id)
    stream_id = int(route.stream_id)
    stmt = select(RouteClassificationRule).where(RouteClassificationRule.route_id == route_id)
    if enabled_only:
        stmt = stmt.where(RouteClassificationRule.enabled.is_(True))
    stmt = stmt.order_by(RouteClassificationRule.name, RouteClassificationRule.id)
    rules = list(db.execute(stmt).scalars())
    return stream_id, [_rule_entry(r, stream_id=stream_id) for r in rules]


def create_route_classification_rule(
    db: Session,
    *,
    route_id: int,
    name: str,
    enabled: bool,
    condition_json: dict[str, Any],
    classification_level: str,
) -> RouteClassificationRule:
    _load_route(db, route_id)
    label = name.strip()
    if not label:
        raise ClassificationRuleValidationError("name is required")
    _validate_condition_json(condition_json)
    level = normalize_level(classification_level)
    if level is None:
        raise ClassificationRuleValidationError(f"unsupported classification_level: {classification_level!r}")
    now = datetime.now(timezone.utc)
    rule = RouteClassificationRule(
        route_id=route_id,
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


def patch_route_classification_rule(
    db: Session,
    *,
    route_id: int,
    rule_id: int,
    name: str | None = None,
    enabled: bool | None = None,
    condition_json: dict[str, Any] | None = None,
    classification_level: str | None = None,
) -> RouteClassificationRule:
    rule = db.execute(
        select(RouteClassificationRule).where(
            RouteClassificationRule.id == rule_id,
            RouteClassificationRule.route_id == route_id,
        )
    ).scalar_one_or_none()
    if rule is None:
        raise RouteClassificationRuleNotFoundError(rule_id)
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


def delete_route_classification_rule(db: Session, *, route_id: int, rule_id: int) -> None:
    rule = db.execute(
        select(RouteClassificationRule).where(
            RouteClassificationRule.id == rule_id,
            RouteClassificationRule.route_id == route_id,
        )
    ).scalar_one_or_none()
    if rule is None:
        raise RouteClassificationRuleNotFoundError(rule_id)
    db.delete(rule)
