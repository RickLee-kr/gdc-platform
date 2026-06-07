"""Policy dry-run simulation — evaluate draft rules against sample events (M18.3)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.classification.metrics import CLASSIFICATION_COMPLETE_STAGE
from app.governance_policies.service import (
    GovernancePolicyNotFoundError,
    GovernancePolicyValidationError,
    _validate_policy_json,
    get_governance_policy,
    list_policy_assignments,
)
from app.logs.models import DeliveryLog

MAX_SAMPLE_EVENTS = 30

_OPERATOR_REASON_LABELS = {
    "equals": "equals",
    "not_equals": "does not equal",
    "contains": "contains",
}


class GovernancePolicySimulationError(Exception):
    pass


def _match_scalar(actual: str, operator: str, expected: str) -> bool:
    actual_norm = actual.strip()
    expected_norm = expected.strip()
    if operator == "equals":
        return actual_norm.lower() == expected_norm.lower()
    if operator == "not_equals":
        return actual_norm.lower() != expected_norm.lower()
    if operator == "contains":
        return expected_norm.lower() in actual_norm.lower()
    return False


def _event_field_value(event: dict[str, Any], field: str) -> str:
    if field == "classification":
        return str(event.get("classification") or event.get("classification_level") or "")
    if field == "sensitivity":
        return str(event.get("sensitivity") or event.get("sensitivity_class") or "")
    if field == "field":
        return str(event.get("field") or event.get("field_path") or "")
    value = event.get(field)
    return "" if value is None else str(value)


def _condition_reason(condition: dict[str, Any], *, matched: bool) -> str:
    field = str(condition.get("field") or "")
    operator = str(condition.get("operator") or "equals")
    value = str(condition.get("value") or "")
    op_label = _OPERATOR_REASON_LABELS.get(operator, operator)
    prefix = "" if matched else "Failed: "
    return f"{prefix}{field} {op_label} {value}"


def _evaluate_event(
    event: dict[str, Any],
    conditions: list[dict[str, Any]],
    actions: list[dict[str, Any]],
) -> dict[str, Any]:
    matched_parts: list[str] = []
    failed_reason: str | None = None

    for condition in conditions:
        actual = _event_field_value(event, str(condition.get("field") or ""))
        operator = str(condition.get("operator") or "equals")
        expected = str(condition.get("value") or "")
        cond_matched = _match_scalar(actual, operator, expected)
        if cond_matched:
            matched_parts.append(_condition_reason(condition, matched=True))
        elif failed_reason is None:
            failed_reason = _condition_reason(condition, matched=False)

    all_matched = len(matched_parts) == len(conditions) and bool(conditions)
    action_types = [str(action.get("type") or "") for action in actions if action.get("type")]

    if all_matched:
        reason = " AND ".join(matched_parts)
        return {"matched": True, "actions": action_types, "reason": reason}

    if failed_reason:
        return {"matched": False, "actions": [], "reason": failed_reason}
    return {"matched": False, "actions": [], "reason": "No conditions defined"}


def _normalize_sample_events(sample_events: list[Any]) -> list[dict[str, Any]]:
    if not isinstance(sample_events, list):
        raise GovernancePolicySimulationError("sample_events must be an array")
    if len(sample_events) > MAX_SAMPLE_EVENTS:
        raise GovernancePolicySimulationError(f"sample_events exceeds limit of {MAX_SAMPLE_EVENTS}")
    normalized: list[dict[str, Any]] = []
    for idx, event in enumerate(sample_events):
        if not isinstance(event, dict):
            raise GovernancePolicySimulationError(f"sample_events[{idx}] must be an object")
        normalized.append(dict(event))
    return normalized


def _payload_to_sample_event(payload: dict[str, Any]) -> dict[str, Any]:
    event = dict(payload)
    if "classification" not in event and "classification_level" in event:
        event["classification"] = event["classification_level"]
    return event


def fetch_recent_sample_events(
    db: Session,
    *,
    stream_ids: list[int],
    limit: int = 10,
) -> list[dict[str, Any]]:
    if not stream_ids:
        return []
    capped = max(1, min(limit, MAX_SAMPLE_EVENTS))
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    rows = (
        db.query(DeliveryLog)
        .filter(
            DeliveryLog.stream_id.in_(stream_ids),
            DeliveryLog.stage == CLASSIFICATION_COMPLETE_STAGE,
            DeliveryLog.created_at >= since,
        )
        .order_by(DeliveryLog.created_at.desc())
        .limit(capped)
        .all()
    )
    events: list[dict[str, Any]] = []
    for row in rows:
        payload = row.payload_sample if isinstance(row.payload_sample, dict) else {}
        if payload:
            events.append(_payload_to_sample_event(payload))
    return events


def _resolve_stream_ids(
    db: Session,
    *,
    policy_id: int | None,
    stream_ids: list[int] | None,
) -> list[int]:
    if stream_ids:
        return sorted({int(sid) for sid in stream_ids})
    if policy_id is None:
        return []
    assignments = list_policy_assignments(db, policy_id)
    return sorted({int(a["stream_id"]) for a in assignments if a.get("enabled", True)})


def simulate_policy(
    *,
    policy_json: dict[str, Any],
    sample_events: list[Any],
    db: Session | None = None,
    stream_ids: list[int] | None = None,
    policy_id: int | None = None,
) -> dict[str, Any]:
    _validate_policy_json(policy_json)
    events = _normalize_sample_events(sample_events)
    if not events and db is not None:
        resolved = _resolve_stream_ids(db, policy_id=policy_id, stream_ids=stream_ids)
        events = fetch_recent_sample_events(db, stream_ids=resolved)
    if not events:
        raise GovernancePolicySimulationError("sample_events is required when no recent runtime data is available")

    conditions = policy_json.get("conditions") or []
    actions = policy_json.get("actions") or []
    results = [_evaluate_event(event, conditions, actions) for event in events]
    return {"events": results}


def simulate_policy_json(
    *,
    policy_json: dict[str, Any],
    sample_events: list[Any],
    db: Session | None = None,
    stream_ids: list[int] | None = None,
) -> dict[str, Any]:
    try:
        return simulate_policy(
            policy_json=policy_json,
            sample_events=sample_events,
            db=db,
            stream_ids=stream_ids,
        )
    except GovernancePolicyValidationError as exc:
        raise GovernancePolicySimulationError(str(exc)) from exc


def simulate_saved_policy(
    db: Session,
    *,
    policy_id: int,
    sample_events: list[Any],
    stream_ids: list[int] | None = None,
) -> dict[str, Any]:
    row = get_governance_policy(db, policy_id)
    if row is None:
        raise GovernancePolicyNotFoundError(policy_id)
    try:
        return simulate_policy(
            policy_json=dict(row.policy_json),
            sample_events=sample_events,
            db=db,
            stream_ids=stream_ids,
            policy_id=policy_id,
        )
    except GovernancePolicyValidationError as exc:
        raise GovernancePolicySimulationError(str(exc)) from exc
