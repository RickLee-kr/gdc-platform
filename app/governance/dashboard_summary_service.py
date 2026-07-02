"""Executive Governance Dashboard aggregates (M20.3)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.governance.schemas import (
    GovernanceDashboardActivityEntry,
    GovernanceDashboardComplianceSnapshot,
    GovernanceDashboardPolicyHealth,
    GovernanceDashboardRiskDistribution,
    GovernanceDashboardSummaryResponse,
)
from app.governance_audit.service import list_governance_dashboard_recent_activity
from app.governance_notifications.service import NotificationService
from app.governance_operations.service import (
    _count_failed_replays,
    _count_open_violations,
    _count_pending_approvals,
    _count_policies_by_status,
    _count_quarantined_events,
    _count_quarantined_events_24h,
    _count_replay_failures_24h,
)
from app.governance_policies.models import POLICY_STATUS_ACTIVE, POLICY_STATUS_REVIEW
from app.governance_violations.models import (
    VIOLATION_SEVERITY_HIGH,
    VIOLATION_SEVERITY_LOW,
    VIOLATION_SEVERITY_MEDIUM,
)
from app.governance_violations.service import (
    count_open_violations_by_severity,
    count_quarantine_violations_in_window,
)
from app.replay.models import REPLAY_STATUS_FAILED, REPLAY_STATUS_PENDING, StreamReplayEvent

logger = logging.getLogger(__name__)

_ACTIVITY_LABELS: dict[str, str] = {
    "SUBMITTED_FOR_REVIEW": "Policy submitted for review",
    "APPROVED": "Policy approved",
    "REJECTED": "Policy rejected",
    "REQUEST_CHANGES": "Changes requested",
    "ACTIVATED": "Policy activated",
    "APPROVAL_ACTIVATED": "Policy activated",
    "POLICY_ACTIVATED": "Policy activated",
    "VIOLATION_CREATED": "Violation created",
    "QUARANTINE_CREATED": "Quarantined",
    "QUARANTINE_RELEASED": "Quarantine released",
    "QUARANTINE_DISCARDED": "Quarantine discarded",
    "REPLAY_STARTED": "Replay started",
    "REPLAY_COMPLETED": "Replay completed",
    "REPLAY_FAILED": "Replay failed",
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _activity_label(event_type: str) -> str:
    return _ACTIVITY_LABELS.get(str(event_type), str(event_type).replace("_", " ").title())


def _count_replays_24h(db: Session, *, since: datetime, until: datetime) -> int:
    completed = int(
        db.scalar(
            select(func.count())
            .select_from(StreamReplayEvent)
            .where(
                StreamReplayEvent.updated_at >= since,
                StreamReplayEvent.updated_at < until,
            )
        )
        or 0
    )
    return completed


def degraded_governance_dashboard_summary(
    *,
    warnings: list[str] | None = None,
    read_status: str = "degraded",
) -> GovernanceDashboardSummaryResponse:
    """Empty executive dashboard when aggregation fails (HTTP 200 for operators)."""

    return GovernanceDashboardSummaryResponse(
        read_status=read_status,  # type: ignore[arg-type]
        warnings=warnings or ["governance dashboard summary unavailable"],
    )


def get_governance_dashboard_summary(db: Session) -> GovernanceDashboardSummaryResponse:
    try:
        return _build_governance_dashboard_summary(db)
    except OperationalError as exc:
        logger.warning(
            "%s",
            {
                "stage": "governance_dashboard_summary_degraded",
                "error_type": type(exc).__name__,
                "message": str(exc)[:300],
            },
        )
        return degraded_governance_dashboard_summary(
            warnings=["read timed out or was cancelled; showing empty summary"],
            read_status="degraded",
        )
    except Exception:
        logger.exception("governance_dashboard_summary_failed")
        return degraded_governance_dashboard_summary(
            warnings=["unexpected error building governance dashboard summary"],
            read_status="degraded",
        )


def _build_governance_dashboard_summary(db: Session) -> GovernanceDashboardSummaryResponse:
    now = _utc_now()
    since_24h = now - timedelta(hours=24)

    policy_counts = _count_policies_by_status(db)
    active = policy_counts.get(POLICY_STATUS_ACTIVE, 0)
    review = policy_counts.get(POLICY_STATUS_REVIEW, 0)

    open_violations = _count_open_violations(db)
    quarantined = _count_quarantined_events(db)
    failed_replays = _count_failed_replays(db)
    pending_approvals = _count_pending_approvals(db)

    notification_health = NotificationService.get_health(db)
    notification_failures = notification_health.failed_notifications

    severity_counts = count_open_violations_by_severity(db)
    critical = failed_replays + notification_failures
    high = severity_counts[VIOLATION_SEVERITY_HIGH]
    medium = severity_counts[VIOLATION_SEVERITY_MEDIUM]
    low = severity_counts[VIOLATION_SEVERITY_LOW]

    policy_critical = min(active, high + failed_replays + notification_failures)
    policy_warning = review + medium
    policy_healthy = max(0, active - policy_critical)

    audit_events = list_governance_dashboard_recent_activity(db, window="30d", limit=10)
    recent_activity = [
        GovernanceDashboardActivityEntry(
            event_time=row.event_time,
            event_type=str(row.event_type),
            event_label=_activity_label(str(row.event_type)),
            policy_id=row.policy_id,
            policy_name=row.policy_name or None,
            stream_id=row.stream_id,
            stream_name=row.stream_name,
            status=str(row.status),
        )
        for row in audit_events[:10]
    ]

    violations_24h = count_quarantine_violations_in_window(db, since=since_24h, until=now)

    return GovernanceDashboardSummaryResponse(
        active_policies=active,
        policies_in_review=review,
        open_violations=open_violations,
        quarantined_events=quarantined,
        failed_replays=failed_replays,
        notification_failures=notification_failures,
        pending_approvals=pending_approvals,
        pending_replays=int(
            db.scalar(
                select(func.count())
                .select_from(StreamReplayEvent)
                .where(StreamReplayEvent.status == REPLAY_STATUS_PENDING)
            )
            or 0
        ),
        risk=GovernanceDashboardRiskDistribution(
            critical=critical,
            high=high,
            medium=medium,
            low=low,
        ),
        policy_health=GovernanceDashboardPolicyHealth(
            healthy=policy_healthy,
            warning=policy_warning,
            critical=policy_critical,
        ),
        compliance_snapshot=GovernanceDashboardComplianceSnapshot(
            violations_24h=violations_24h,
            quarantines_24h=_count_quarantined_events_24h(db, since=since_24h, until=now),
            replays_24h=_count_replays_24h(db, since=since_24h, until=now),
        ),
        recent_activity=recent_activity,
        read_status="ok",
        warnings=[],
    )
