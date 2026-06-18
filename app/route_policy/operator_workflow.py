"""Per-route policy operator workflow (M13.5 P2)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.protection.policy_operator_workflow import (
    PolicyRuleValidationError,
    _validate_action_type,
    _validate_condition_json,
)
from app.route_policy.models import RoutePolicyRule
from app.routes.models import Route
from app.runtime.control_service import RouteNotFoundError


class RoutePolicyRuleNotFoundError(Exception):
    def __init__(self, rule_id: int) -> None:
        self.rule_id = rule_id
        super().__init__(f"route policy rule not found: {rule_id}")


def _load_route(db: Session, route_id: int) -> Route:
    route = db.query(Route).filter(Route.id == route_id).first()
    if route is None:
        raise RouteNotFoundError(route_id)
    return route


def _rule_entry(rule: RoutePolicyRule, *, stream_id: int) -> dict[str, Any]:
    return {
        "id": int(rule.id),
        "route_id": int(rule.route_id),
        "stream_id": stream_id,
        "name": rule.name,
        "enabled": bool(rule.enabled),
        "condition_json": dict(rule.condition_json) if isinstance(rule.condition_json, dict) else {},
        "action_type": rule.action_type,
        "created_at": rule.created_at,
        "updated_at": rule.updated_at,
    }


def list_route_policy_rules(
    db: Session,
    route_id: int,
    *,
    enabled_only: bool = False,
) -> tuple[int, list[dict[str, Any]]]:
    route = _load_route(db, route_id)
    stream_id = int(route.stream_id)
    stmt = select(RoutePolicyRule).where(RoutePolicyRule.route_id == route_id)
    if enabled_only:
        stmt = stmt.where(RoutePolicyRule.enabled.is_(True))
    stmt = stmt.order_by(RoutePolicyRule.name, RoutePolicyRule.id)
    rules = list(db.execute(stmt).scalars())
    return stream_id, [_rule_entry(r, stream_id=stream_id) for r in rules]


def create_route_policy_rule(
    db: Session,
    *,
    route_id: int,
    name: str,
    enabled: bool,
    condition_json: dict[str, Any],
    action_type: str,
) -> RoutePolicyRule:
    _load_route(db, route_id)
    label = name.strip()
    if not label:
        raise PolicyRuleValidationError("name is required")
    _validate_condition_json(condition_json)
    _validate_action_type(action_type)
    now = datetime.now(timezone.utc)
    rule = RoutePolicyRule(
        route_id=route_id,
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


def patch_route_policy_rule(
    db: Session,
    *,
    route_id: int,
    rule_id: int,
    name: str | None = None,
    enabled: bool | None = None,
    condition_json: dict[str, Any] | None = None,
    action_type: str | None = None,
) -> RoutePolicyRule:
    rule = db.execute(
        select(RoutePolicyRule).where(
            RoutePolicyRule.id == rule_id,
            RoutePolicyRule.route_id == route_id,
        )
    ).scalar_one_or_none()
    if rule is None:
        raise RoutePolicyRuleNotFoundError(rule_id)
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


def delete_route_policy_rule(db: Session, *, route_id: int, rule_id: int) -> None:
    rule = db.execute(
        select(RoutePolicyRule).where(
            RoutePolicyRule.id == rule_id,
            RoutePolicyRule.route_id == route_id,
        )
    ).scalar_one_or_none()
    if rule is None:
        raise RoutePolicyRuleNotFoundError(rule_id)
    db.delete(rule)
