"""Policy impact analysis — read-only aggregates from existing runtime telemetry (M18.2)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
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
from app.protection.metrics import PROTECTION_COMPLETE_STAGE
from app.protection.policy_metrics import POLICY_EVALUATION_COMPLETE_STAGE
from app.quarantine.metrics import QUARANTINE_EVENT_CREATED_STAGE
from app.sensitive_detection.models import StreamSensitiveFinding
from app.streams.models import Stream

IMPACT_WINDOW = "24h"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _window_bounds(*, until: datetime | None = None) -> tuple[datetime, datetime]:
    end = until or _utc_now()
    start = end - timedelta(hours=24)
    return start, end


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


def _load_stream_names(db: Session, stream_ids: list[int]) -> dict[int, str]:
    if not stream_ids:
        return {}
    rows = db.execute(select(Stream.id, Stream.name).where(Stream.id.in_(stream_ids))).all()
    return {int(row.id): str(row.name) for row in rows}


def _load_stream_findings(db: Session, stream_ids: list[int]) -> dict[int, list[StreamSensitiveFinding]]:
    if not stream_ids:
        return {}
    rows = list(
        db.execute(
            select(StreamSensitiveFinding).where(StreamSensitiveFinding.stream_id.in_(stream_ids))
        ).scalars()
    )
    out: dict[int, list[StreamSensitiveFinding]] = {sid: [] for sid in stream_ids}
    for row in rows:
        out.setdefault(int(row.stream_id), []).append(row)
    return out


def _condition_matches_row(
    condition: dict[str, Any],
    *,
    payload: dict[str, Any],
    findings: list[StreamSensitiveFinding],
) -> bool:
    field = str(condition.get("field") or "")
    operator = str(condition.get("operator") or "equals")
    value = str(condition.get("value") or "")

    if field == "classification":
        actual = str(payload.get("classification_level") or "")
        return _match_scalar(actual, operator, value)

    if field == "sensitivity":
        if not findings:
            return False
        return any(_match_scalar(str(f.sensitivity_class or ""), operator, value) for f in findings)

    if field == "field":
        if not findings:
            return False
        return any(_match_scalar(str(f.field_path or ""), operator, value) for f in findings)

    return False


def _row_matches_policy(
    payload: dict[str, Any],
    conditions: list[dict[str, Any]],
    findings: list[StreamSensitiveFinding],
) -> bool:
    if not conditions:
        return False
    return all(
        _condition_matches_row(condition, payload=payload, findings=findings) for condition in conditions
    )


def _load_classification_rows(
    db: Session,
    *,
    stream_ids: list[int],
    since: datetime,
    until: datetime,
) -> list[DeliveryLog]:
    if not stream_ids:
        return []
    return (
        db.query(DeliveryLog)
        .filter(
            DeliveryLog.stream_id.in_(stream_ids),
            DeliveryLog.stage == CLASSIFICATION_COMPLETE_STAGE,
            DeliveryLog.created_at >= since,
            DeliveryLog.created_at < until,
        )
        .order_by(DeliveryLog.stream_id, DeliveryLog.created_at.desc())
        .limit(5000)
        .all()
    )


def _count_stage_events(
    db: Session,
    *,
    stream_ids: list[int],
    stage: str,
    since: datetime,
    until: datetime,
) -> int:
    if not stream_ids:
        return 0
    return int(
        db.query(func.count(DeliveryLog.id))
        .filter(
            DeliveryLog.stream_id.in_(stream_ids),
            DeliveryLog.stage == stage,
            DeliveryLog.created_at >= since,
            DeliveryLog.created_at < until,
        )
        .scalar()
        or 0
    )


def _count_protection_action_events(
    db: Session,
    *,
    stream_ids: list[int],
    action_type: str,
    since: datetime,
    until: datetime,
) -> int:
    if not stream_ids:
        return 0
    rows = (
        db.query(DeliveryLog)
        .filter(
            DeliveryLog.stream_id.in_(stream_ids),
            DeliveryLog.stage == PROTECTION_COMPLETE_STAGE,
            DeliveryLog.created_at >= since,
            DeliveryLog.created_at < until,
        )
        .limit(2000)
        .all()
    )
    count = 0
    for row in rows:
        sample = row.payload_sample if isinstance(row.payload_sample, dict) else {}
        if action_type == "tokenize":
            if int(sample.get("tokenization_batch_items") or 0) > 0 or int(sample.get("tokenization_created") or 0) > 0:
                count += max(1, int(sample.get("protected_event_count") or 1))
        elif action_type == "mask":
            if int(sample.get("masked_field_applications") or 0) > 0 or int(sample.get("protected_field_count") or 0) > 0:
                count += max(1, int(sample.get("protected_event_count") or 1))
    return count


def _estimate_action_counts(
    db: Session,
    *,
    stream_ids: list[int],
    actions: list[dict[str, Any]],
    matched_events: int,
    since: datetime,
    until: datetime,
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for action in actions:
        action_type = str(action.get("type") or "")
        if not action_type:
            continue
        if action_type == "quarantine":
            historical = _count_stage_events(
                db,
                stream_ids=stream_ids,
                stage=QUARANTINE_EVENT_CREATED_STAGE,
                since=since,
                until=until,
            )
            counts[action_type] = historical if historical > 0 else matched_events
        elif action_type == "audit_only":
            historical = _count_stage_events(
                db,
                stream_ids=stream_ids,
                stage=POLICY_EVALUATION_COMPLETE_STAGE,
                since=since,
                until=until,
            )
            counts[action_type] = historical if historical > 0 else matched_events
        elif action_type == "tokenize":
            historical = _count_protection_action_events(
                db,
                stream_ids=stream_ids,
                action_type="tokenize",
                since=since,
                until=until,
            )
            counts[action_type] = historical if historical > 0 else matched_events
        elif action_type == "mask":
            historical = _count_protection_action_events(
                db,
                stream_ids=stream_ids,
                action_type="mask",
                since=since,
                until=until,
            )
            counts[action_type] = historical if historical > 0 else matched_events
        else:
            counts[action_type] = matched_events
    return counts


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


def _compute_matched_counts(
    db: Session,
    *,
    policy_json: dict[str, Any],
    stream_ids: list[int],
    since: datetime,
    until: datetime,
) -> tuple[int, int, list[dict[str, Any]]]:
    conditions = policy_json.get("conditions") or []
    findings_by_stream = _load_stream_findings(db, stream_ids)
    stream_names = _load_stream_names(db, stream_ids)
    rows = _load_classification_rows(db, stream_ids=stream_ids, since=since, until=until)

    per_stream_total: dict[int, int] = {sid: 0 for sid in stream_ids}
    per_stream_matched: dict[int, int] = {sid: 0 for sid in stream_ids}

    for row in rows:
        stream_id = int(row.stream_id) if row.stream_id is not None else 0
        if stream_id not in per_stream_total:
            continue
        per_stream_total[stream_id] += 1
        payload = row.payload_sample if isinstance(row.payload_sample, dict) else {}
        findings = findings_by_stream.get(stream_id, [])
        if _row_matches_policy(payload, conditions, findings):
            per_stream_matched[stream_id] += 1

    total_events = sum(per_stream_total.values())
    matched_events = sum(per_stream_matched.values())
    streams = [
        {
            "stream_id": sid,
            "stream_name": stream_names.get(sid, f"Stream {sid}"),
            "total_events": per_stream_total.get(sid, 0),
            "matched_events": per_stream_matched.get(sid, 0),
        }
        for sid in stream_ids
        if per_stream_total.get(sid, 0) > 0 or sid in stream_names
    ]
    streams.sort(key=lambda item: (-int(item["matched_events"]), int(item["stream_id"])))
    return total_events, matched_events, streams


def build_policy_impact(
    db: Session,
    *,
    policy_json: dict[str, Any],
    stream_ids: list[int],
    baseline_policy_json: dict[str, Any] | None = None,
    until: datetime | None = None,
) -> dict[str, Any]:
    _validate_policy_json(policy_json)
    since, end = _window_bounds(until=until)
    actions = policy_json.get("actions") or []

    total_events, matched_events, streams = _compute_matched_counts(
        db,
        policy_json=policy_json,
        stream_ids=stream_ids,
        since=since,
        until=end,
    )
    action_counts = _estimate_action_counts(
        db,
        stream_ids=stream_ids,
        actions=actions,
        matched_events=matched_events,
        since=since,
        until=end,
    )

    delta: dict[str, int | None] = {"matched_events_change": None}
    if baseline_policy_json is not None:
        try:
            _validate_policy_json(baseline_policy_json)
            _, baseline_matched, _ = _compute_matched_counts(
                db,
                policy_json=baseline_policy_json,
                stream_ids=stream_ids,
                since=since,
                until=end,
            )
            delta["matched_events_change"] = matched_events - baseline_matched
        except GovernancePolicyValidationError:
            delta["matched_events_change"] = None

    return {
        "window": IMPACT_WINDOW,
        "total_events": total_events,
        "matched_events": matched_events,
        "actions": action_counts,
        "streams": streams,
        "delta": delta,
        "data_available": total_events > 0,
    }


def analyze_saved_policy_impact(db: Session, policy_id: int) -> dict[str, Any]:
    row = get_governance_policy(db, policy_id)
    if row is None:
        raise GovernancePolicyNotFoundError(policy_id)
    stream_ids = _resolve_stream_ids(db, policy_id=policy_id, stream_ids=None)
    return build_policy_impact(
        db,
        policy_json=dict(row.policy_json),
        stream_ids=stream_ids,
        baseline_policy_json=None,
    )


def analyze_policy_impact_preview(
    db: Session,
    *,
    policy_json: dict[str, Any],
    policy_id: int | None = None,
    stream_ids: list[int] | None = None,
) -> dict[str, Any]:
    resolved_stream_ids = _resolve_stream_ids(db, policy_id=policy_id, stream_ids=stream_ids)
    baseline: dict[str, Any] | None = None
    if policy_id is not None:
        row = get_governance_policy(db, policy_id)
        if row is None:
            raise GovernancePolicyNotFoundError(policy_id)
        baseline = dict(row.policy_json)
    return build_policy_impact(
        db,
        policy_json=policy_json,
        stream_ids=resolved_stream_ids,
        baseline_policy_json=baseline,
    )


def impact_summary_for_policy(
    db: Session,
    *,
    policy_id: int,
    policy_json: dict[str, Any],
    stream_ids: list[int],
) -> dict[str, Any]:
    """Lightweight summary for catalog rows."""

    try:
        impact = build_policy_impact(
            db,
            policy_json=policy_json,
            stream_ids=stream_ids,
            baseline_policy_json=None,
        )
    except GovernancePolicyValidationError:
        return {"impact_matched_events": None, "impact_data_available": False, "impact_summary": None}

    matched = int(impact.get("matched_events") or 0)
    data_available = bool(impact.get("data_available"))
    summary: str | None = None
    if data_available:
        if matched >= 1000:
            label = f"{matched / 1000:.1f}K".replace(".0K", "K")
        else:
            label = str(matched)
        summary = f"{label} matches / 24h"
    return {
        "impact_matched_events": matched if data_available else None,
        "impact_data_available": data_available,
        "impact_summary": summary,
    }
