"""Policy-centric governance dashboard aggregates (M18.5)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.governance.schemas import (
    PolicyActivityTimelineEvent,
    PolicyCatalogSummaryRow,
    PolicyDashboardData,
    PolicyDashboardKpi,
    PolicyImpactRankRow,
    PolicyKpiCounts,
    WindowedEventSummary,
)
from app.governance_policies.impact_service import impact_summary_for_policy
from app.governance_policies.models import (
    POLICY_STATUS_ACTIVE,
    POLICY_STATUS_DRAFT,
    POLICY_STATUS_RETIRED,
    POLICY_STATUS_REVIEW,
    GovernancePolicy,
    StreamPolicyAssignment,
)
from app.logs.models import DeliveryLog
from app.quarantine.metrics import QUARANTINE_EVENT_CREATED_STAGE
from app.quarantine.models import QUARANTINE_STATUS_QUARANTINED, StreamQuarantineEvent
from app.replay.metrics import REPLAY_EVENT_REPLAYED_STAGE
from app.replay.models import REPLAY_STATUS_REPLAYED, StreamReplayEvent

_POLICY_CATALOG_LIMIT = 10
_POLICY_TIMELINE_LIMIT = 20
_TOP_IMPACT_LIMIT = 5

_TIMELINE_EVENT_LABELS = {
    "created": "Policy created",
    "submitted": "Policy submitted for review",
    "activated": "Policy activated",
    "retired": "Policy retired",
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _count_stage_in_window(
    db: Session,
    *,
    stage: str,
    since: datetime,
    until: datetime,
) -> int:
    return int(
        db.query(func.count(DeliveryLog.id))
        .filter(
            DeliveryLog.created_at >= since,
            DeliveryLog.created_at < until,
            DeliveryLog.stage == stage,
        )
        .scalar()
        or 0
    )


def _build_windowed_stage_summary(db: Session, *, stage: str, until: datetime) -> WindowedEventSummary:
    return WindowedEventSummary(
        h24=_count_stage_in_window(db, stage=stage, since=until - timedelta(hours=24), until=until),
        d7=_count_stage_in_window(db, stage=stage, since=until - timedelta(days=7), until=until),
        d30=_count_stage_in_window(db, stage=stage, since=until - timedelta(days=30), until=until),
    )


def _count_quarantine_rows_in_window(
    db: Session,
    *,
    since: datetime,
    until: datetime,
) -> int:
    return int(
        db.query(func.count(StreamQuarantineEvent.id))
        .filter(
            StreamQuarantineEvent.created_at >= since,
            StreamQuarantineEvent.created_at < until,
        )
        .scalar()
        or 0
    )


def _count_replay_rows_in_window(
    db: Session,
    *,
    since: datetime,
    until: datetime,
) -> int:
    return int(
        db.query(func.count(StreamReplayEvent.id))
        .filter(
            StreamReplayEvent.status == REPLAY_STATUS_REPLAYED,
            StreamReplayEvent.updated_at >= since,
            StreamReplayEvent.updated_at < until,
        )
        .scalar()
        or 0
    )


def _build_quarantine_summary(db: Session, *, until: datetime) -> WindowedEventSummary:
    log_summary = _build_windowed_stage_summary(db, stage=QUARANTINE_EVENT_CREATED_STAGE, until=until)
    if log_summary.h24 or log_summary.d7 or log_summary.d30:
        return log_summary
    return WindowedEventSummary(
        h24=_count_quarantine_rows_in_window(db, since=until - timedelta(hours=24), until=until),
        d7=_count_quarantine_rows_in_window(db, since=until - timedelta(days=7), until=until),
        d30=_count_quarantine_rows_in_window(db, since=until - timedelta(days=30), until=until),
    )


def _build_replay_summary(db: Session, *, until: datetime) -> WindowedEventSummary:
    log_summary = _build_windowed_stage_summary(db, stage=REPLAY_EVENT_REPLAYED_STAGE, until=until)
    if log_summary.h24 or log_summary.d7 or log_summary.d30:
        return log_summary
    return WindowedEventSummary(
        h24=_count_replay_rows_in_window(db, since=until - timedelta(hours=24), until=until),
        d7=_count_replay_rows_in_window(db, since=until - timedelta(days=7), until=until),
        d30=_count_replay_rows_in_window(db, since=until - timedelta(days=30), until=until),
    )


def _assignment_counts(db: Session, policy_ids: list[int]) -> dict[int, int]:
    if not policy_ids:
        return {}
    rows = db.execute(
        select(StreamPolicyAssignment.policy_id, func.count(StreamPolicyAssignment.id))
        .where(StreamPolicyAssignment.policy_id.in_(policy_ids))
        .where(StreamPolicyAssignment.enabled.is_(True))
        .group_by(StreamPolicyAssignment.policy_id)
    ).all()
    return {int(policy_id): int(count) for policy_id, count in rows}


def _policy_kpi_counts(db: Session) -> PolicyKpiCounts:
    rows = db.execute(
        select(GovernancePolicy.status, func.count(GovernancePolicy.id)).group_by(GovernancePolicy.status)
    ).all()
    counts = {str(status): int(count) for status, count in rows}
    return PolicyKpiCounts(
        active=counts.get(POLICY_STATUS_ACTIVE, 0),
        review=counts.get(POLICY_STATUS_REVIEW, 0),
        draft=counts.get(POLICY_STATUS_DRAFT, 0),
        retired=counts.get(POLICY_STATUS_RETIRED, 0),
    )


def _policy_timeline_events(rows: list[GovernancePolicy]) -> list[PolicyActivityTimelineEvent]:
    events: list[PolicyActivityTimelineEvent] = []
    for row in rows:
        name = str(row.name)
        if row.created_at is not None:
            events.append(
                PolicyActivityTimelineEvent(
                    event_type="created",
                    policy_id=int(row.id),
                    policy_name=name,
                    occurred_at=row.created_at,
                    label=f'Policy "{name}" created',
                )
            )
        if row.status in {POLICY_STATUS_REVIEW, POLICY_STATUS_ACTIVE, POLICY_STATUS_RETIRED}:
            submitted_at = row.updated_at or row.created_at
            if submitted_at is not None:
                events.append(
                    PolicyActivityTimelineEvent(
                        event_type="submitted",
                        policy_id=int(row.id),
                        policy_name=name,
                        occurred_at=submitted_at,
                        label=f'Policy "{name}" submitted for review',
                    )
                )
        if row.activated_at is not None:
            events.append(
                PolicyActivityTimelineEvent(
                    event_type="activated",
                    policy_id=int(row.id),
                    policy_name=name,
                    occurred_at=row.activated_at,
                    label=f'Policy "{name}" activated',
                )
            )
        if row.retired_at is not None:
            events.append(
                PolicyActivityTimelineEvent(
                    event_type="retired",
                    policy_id=int(row.id),
                    policy_name=name,
                    occurred_at=row.retired_at,
                    label=f'Policy "{name}" retired',
                )
            )
    events.sort(key=lambda item: item.occurred_at, reverse=True)
    return events[:_POLICY_TIMELINE_LIMIT]


def build_policy_dashboard(
    db: Session,
    *,
    pending_quarantine_events: int,
    replayed_events_24h: int,
    until: datetime | None = None,
) -> PolicyDashboardData:
    """Aggregate policy-centric dashboard data from existing tables only."""

    end = until or _utc_now()
    rows = list(db.execute(select(GovernancePolicy).order_by(GovernancePolicy.updated_at.desc())).scalars())
    has_policies = len(rows) > 0
    policy_kpi = _policy_kpi_counts(db)
    assignment_map = _assignment_counts(db, [row.id for row in rows])

    catalog_rows: list[PolicyCatalogSummaryRow] = []
    impact_rows: list[PolicyImpactRankRow] = []

    for row in rows[:_POLICY_CATALOG_LIMIT]:
        stream_ids = list(
            db.execute(
                select(StreamPolicyAssignment.stream_id)
                .where(StreamPolicyAssignment.policy_id == row.id)
                .where(StreamPolicyAssignment.enabled.is_(True))
            ).scalars()
        )
        impact = impact_summary_for_policy(
            db,
            policy_id=row.id,
            policy_json=dict(row.policy_json),
            stream_ids=[int(sid) for sid in stream_ids],
        )
        matched = impact.get("impact_matched_events")
        catalog_rows.append(
            PolicyCatalogSummaryRow(
                id=int(row.id),
                name=str(row.name),
                status=str(row.status),
                assigned_stream_count=assignment_map.get(row.id, 0),
                impact_matched_events=int(matched) if matched is not None else None,
                impact_summary=impact.get("impact_summary"),
                impact_data_available=bool(impact.get("impact_data_available")),
            )
        )

    for row in rows:
        stream_ids = list(
            db.execute(
                select(StreamPolicyAssignment.stream_id)
                .where(StreamPolicyAssignment.policy_id == row.id)
                .where(StreamPolicyAssignment.enabled.is_(True))
            ).scalars()
        )
        impact = impact_summary_for_policy(
            db,
            policy_id=row.id,
            policy_json=dict(row.policy_json),
            stream_ids=[int(sid) for sid in stream_ids],
        )
        matched = impact.get("impact_matched_events")
        if matched is None:
            continue
        impact_rows.append(
            PolicyImpactRankRow(
                policy_id=int(row.id),
                policy_name=str(row.name),
                matched_events=int(matched),
                impact_summary=impact.get("impact_summary"),
            )
        )

    impact_rows.sort(key=lambda item: item.matched_events, reverse=True)

    return PolicyDashboardData(
        has_policies=has_policies,
        policy_kpi=policy_kpi,
        dashboard_kpi=PolicyDashboardKpi(
            active_policies=policy_kpi.active,
            policies_in_review=policy_kpi.review,
            quarantined_events=pending_quarantine_events,
            replayed_events=replayed_events_24h,
        ),
        policy_activity_timeline=_policy_timeline_events(rows),
        policy_catalog=catalog_rows,
        top_policies_by_impact=impact_rows[:_TOP_IMPACT_LIMIT],
        quarantine_summary=_build_quarantine_summary(db, until=end),
        replay_summary=_build_replay_summary(db, until=end),
    )
