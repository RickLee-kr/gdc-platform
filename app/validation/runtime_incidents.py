"""Operations Center runtime incidents — aligned with current_runtime health posture."""

from __future__ import annotations

from typing import Any, Literal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.runtime import health_service
from app.runtime.health_repository import fetch_health_scoring_excluded_stream_ids
from app.runtime.health_schemas import HealthLevel
from app.validation.alert_service import alert_row_to_read_dict
from app.validation.models import ContinuousValidation, ValidationAlert

ScoringMode = Literal["current_runtime", "historical_analytics"]

_LIVE_VALIDATION_STATUSES = frozenset({"FAILING", "DEGRADED"})
_DELIVERY_UNHEALTHY_LEVELS: frozenset[HealthLevel] = frozenset({"UNHEALTHY", "CRITICAL"})
_AUTH_ALERT_TYPES = frozenset({"AUTH_FAILURE"})
_CHECKPOINT_ALERT_TYPES = frozenset({"CHECKPOINT_DRIFT"})
def _excluded_stream_ids(db: Session) -> set[int]:
    return set(fetch_health_scoring_excluded_stream_ids(db))


def _live_validation_incident_filter(excluded_stream_ids: set[int]) -> list[Any]:
    clauses: list[Any] = [
        ValidationAlert.status == "OPEN",
        ContinuousValidation.last_status.in_(tuple(_LIVE_VALIDATION_STATUSES)),
    ]
    if excluded_stream_ids:
        clauses.append(
            or_(
                ContinuousValidation.target_stream_id.is_(None),
                ContinuousValidation.target_stream_id.notin_(list(excluded_stream_ids)),
            )
        )
    return clauses


def _count_open_alerts_by_types(
    db: Session,
    *,
    alert_types: frozenset[str],
    excluded_stream_ids: set[int],
) -> int:
    stmt = (
        select(func.count())
        .select_from(ValidationAlert)
        .join(ContinuousValidation, ValidationAlert.validation_id == ContinuousValidation.id)
        .where(
            *_live_validation_incident_filter(excluded_stream_ids),
            ValidationAlert.alert_type.in_(tuple(alert_types)),
        )
    )
    return int(db.scalar(stmt) or 0)


def _list_live_open_alerts(db: Session, *, limit: int, excluded_stream_ids: set[int]) -> list[dict[str, Any]]:
    lim = min(max(int(limit), 1), 500)
    rows = list(
        db.scalars(
            select(ValidationAlert)
            .join(ContinuousValidation, ValidationAlert.validation_id == ContinuousValidation.id)
            .where(*_live_validation_incident_filter(excluded_stream_ids))
            .order_by(ValidationAlert.id.desc())
            .limit(lim)
        ).all()
    )
    return [alert_row_to_read_dict(a) for a in rows]


def _count_live_failing_validations(db: Session, *, excluded_stream_ids: set[int]) -> int:
    stmt = select(func.count()).select_from(ContinuousValidation).where(
        ContinuousValidation.last_status.in_(tuple(_LIVE_VALIDATION_STATUSES)),
    )
    if excluded_stream_ids:
        stmt = stmt.where(
            or_(
                ContinuousValidation.target_stream_id.is_(None),
                ContinuousValidation.target_stream_id.notin_(list(excluded_stream_ids)),
            )
        )
    return int(db.scalar(stmt) or 0)


def _delivery_incident_counts_from_health(
    db: Session,
    *,
    window: str | None,
    excluded_stream_ids: set[int],
) -> tuple[int, int]:
    """Route-level delivery unhealthy/degraded counts (current_runtime scoring).

    Lab / validation-negative streams are omitted from incident totals only.
    """

    routes = health_service.list_route_health(
        db,
        window=window,
        since=None,
        stream_id=None,
        route_id=None,
        destination_id=None,
        scoring_mode="current_runtime",
    )

    def _counts_toward_incidents(row: object) -> bool:
        sid = getattr(row, "stream_id", None)
        if sid is not None and int(sid) in excluded_stream_ids:
            return False
        return True

    unhealthy = sum(
        1
        for row in routes.rows
        if _counts_toward_incidents(row) and row.level in _DELIVERY_UNHEALTHY_LEVELS
    )
    degraded = sum(
        1 for row in routes.rows if _counts_toward_incidents(row) and row.level == "DEGRADED"
    )
    return unhealthy, degraded


def build_current_runtime_operational_incidents(
    db: Session,
    *,
    window: str | None = "1h",
    failures_limit: int = 20,
) -> dict[str, Any]:
    """Live posture incidents for Operations Center (not historical OPEN-alert totals)."""

    excluded = _excluded_stream_ids(db)
    delivery_unhealthy, delivery_degraded = _delivery_incident_counts_from_health(
        db, window=window, excluded_stream_ids=excluded
    )
    auth_unhealthy = _count_open_alerts_by_types(db, alert_types=_AUTH_ALERT_TYPES, excluded_stream_ids=excluded)
    checkpoint_stalled = _count_open_alerts_by_types(
        db, alert_types=_CHECKPOINT_ALERT_TYPES, excluded_stream_ids=excluded
    )
    latest = _list_live_open_alerts(db, limit=failures_limit, excluded_stream_ids=excluded)

    open_crit = sum(1 for a in latest if str(a.get("severity")) == "CRITICAL")
    open_warn = sum(1 for a in latest if str(a.get("severity")) == "WARNING")
    open_info = sum(1 for a in latest if str(a.get("severity")) == "INFO")

    failing_validations = _count_live_failing_validations(db, excluded_stream_ids=excluded)

    return {
        "failing_validations_count": failing_validations,
        "degraded_validations_count": delivery_degraded,
        "open_alerts_critical": open_crit,
        "open_alerts_warning": open_warn,
        "open_alerts_info": open_info,
        "open_auth_failure_alerts": auth_unhealthy,
        "open_delivery_failure_alerts": delivery_unhealthy,
        "open_checkpoint_drift_alerts": checkpoint_stalled,
        "latest_open_alerts": latest,
        "scoring_mode": "current_runtime",
    }
