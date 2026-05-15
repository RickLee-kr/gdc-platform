"""Validation alert lifecycle: deduplicated OPEN rows, auto-resolve on recovery, async notifications."""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.database import utcnow
from app.streams.models import Stream
from app.validation.alerts import (
    CONSECUTIVE_FAIL_CRITICAL_THRESHOLD,
    CONSECUTIVE_FAIL_WARN_THRESHOLD,
    PROLONGED_FAILING_SECONDS,
    RecoveryCategory,
    ValidationAlertSeverity,
    ValidationAlertType,
    cap_severity_for_overall,
    fingerprint_for,
)
from app.validation.models import ContinuousValidation, ValidationAlert, ValidationRecoveryEvent
from app.validation.notifiers.dispatcher import schedule_validation_notifications
from app.validation.notifiers.base import build_notification_payload
logger = logging.getLogger(__name__)

_ALERT_TYPE_TO_RECOVERY: dict[str, RecoveryCategory] = {
    "AUTH_FAILURE": "AUTH",
    "DESTINATION_FAILURE": "DELIVERY",
    "DELIVERY_MISSING": "DELIVERY",
    "RETRY_EXHAUSTED": "DELIVERY",
    "CHECKPOINT_DRIFT": "CHECKPOINT",
    "VALIDATION_TIMEOUT": "GENERAL",
    "VALIDATION_DEGRADED": "GENERAL",
}


def _load_stream_meta(db: Session, stream_id: int | None) -> tuple[str | None, str | None, int | None]:
    if stream_id is None:
        return None, None, None
    stream = (
        db.query(Stream)
        .options(joinedload(Stream.connector), joinedload(Stream.routes))
        .filter(Stream.id == int(stream_id))
        .first()
    )
    if stream is None:
        return None, None, None
    sname = str(stream.name)
    cname = str(stream.connector.name) if stream.connector is not None else None
    route_id = None
    if stream.routes:
        route_id = int(min(stream.routes, key=lambda r: int(r.id)).id)
    return sname, cname, route_id


def _upsert_open_alert(
    db: Session,
    *,
    validation_id: int,
    validation_run_id: int | None,
    alert_type: ValidationAlertType,
    severity: ValidationAlertSeverity,
    title: str,
    message: str,
    fingerprint: str,
) -> tuple[bool, ValidationAlert]:
    """Return (created_new_row, row). Dedup: refresh message on existing OPEN fingerprint."""

    existing = db.scalars(
        select(ValidationAlert)
        .where(
            ValidationAlert.validation_id == int(validation_id),
            ValidationAlert.fingerprint == fingerprint,
            ValidationAlert.status == "OPEN",
        )
        .limit(1)
    ).first()
    if existing is not None:
        existing.message = message
        existing.title = title
        existing.validation_run_id = validation_run_id
        existing.severity = severity
        db.flush()
        return False, existing
    row = ValidationAlert(
        validation_id=int(validation_id),
        validation_run_id=validation_run_id,
        severity=severity,
        alert_type=str(alert_type),
        status="OPEN",
        title=title,
        message=message,
        fingerprint=fingerprint,
        triggered_at=utcnow(),
    )
    db.add(row)
    db.flush()
    return True, row


def _emit_notifications_if_needed(
    *,
    created_new: bool,
    validation: ContinuousValidation,
    stream_id: int | None,
    stream_name: str | None,
    connector_name: str | None,
    route_id: int | None,
    severity: str,
    alert_type: str | None,
    run_id: str | None,
    validation_run_id: int | None,
    message: str,
    event_kind: str,
) -> None:
    if not created_new:
        return
    payload = build_notification_payload(
        event_kind=event_kind,
        validation_id=int(validation.id),
        validation_name=str(validation.name),
        validation_type=str(validation.validation_type),
        stream_id=stream_id,
        stream_name=stream_name,
        connector_name=connector_name,
        severity=severity,
        alert_type=alert_type,
        last_error=validation.last_error,
        consecutive_failures=int(validation.consecutive_failures or 0),
        run_id=run_id,
        validation_run_id=validation_run_id,
        message=message,
        route_id=route_id,
    )
    schedule_validation_notifications(payload)


def _resolve_open_alerts(db: Session, *, validation_id: int) -> list[ValidationAlert]:
    rows = list(
        db.scalars(
            select(ValidationAlert).where(
                ValidationAlert.validation_id == int(validation_id),
                ValidationAlert.status == "OPEN",
            )
        ).all()
    )
    now = utcnow()
    for r in rows:
        r.status = "RESOLVED"
        r.resolved_at = now
    return rows


def _append_recovery_events(
    db: Session,
    *,
    validation_id: int,
    validation_run_id: int | None,
    resolved: list[ValidationAlert],
) -> list[ValidationRecoveryEvent]:
    """One recovery row per category to keep the timeline compact."""

    categories: set[RecoveryCategory] = set()
    for a in resolved:
        categories.add(_ALERT_TYPE_TO_RECOVERY.get(str(a.alert_type), "GENERAL"))

    events: list[ValidationRecoveryEvent] = []
    for cat in categories:
        title = {
            "AUTH": "Auth validation recovered",
            "DELIVERY": "Destination delivery recovered",
            "CHECKPOINT": "Checkpoint movement restored",
            "GENERAL": "Validation health recovered",
        }[cat]
        msg = f"category={cat}; resolved_open_alerts={len(resolved)}"
        ev = ValidationRecoveryEvent(
            validation_id=int(validation_id),
            validation_run_id=validation_run_id,
            category=str(cat),
            title=title,
            message=msg,
        )
        db.add(ev)
        events.append(ev)
    db.flush()
    return events


def apply_validation_alert_cycle(
    db: Session,
    *,
    validation: ContinuousValidation,
    prev_last_status: str,
    overall: str,
    messages: list[str],
    stats: dict[str, Any],
    summary: dict[str, Any],
    had_auth_failure: bool,
    had_checkpoint_drift: bool,
    validation_run_id: int | None,
    latency_ms: int,
) -> None:
    """Persist alerts/recovery in the same validation DB session (post-runner, pre-commit)."""

    _ = prev_last_status  # reserved for future escalation rules
    stream_id = validation.target_stream_id
    stream_name, connector_name, route_id = _load_stream_meta(db, stream_id)
    run_id = summary.get("run_id") if isinstance(summary.get("run_id"), str) else None
    msg_join = "; ".join(messages) if messages else str(summary.get("message") or overall)

    try:
        if overall == "PASS":
            resolved = _resolve_open_alerts(db, validation_id=int(validation.id))
            if resolved:
                _append_recovery_events(
                    db,
                    validation_id=int(validation.id),
                    validation_run_id=validation_run_id,
                    resolved=resolved,
                )
                payload = build_notification_payload(
                    event_kind="validation_recovered",
                    validation_id=int(validation.id),
                    validation_name=str(validation.name),
                    validation_type=str(validation.validation_type),
                    stream_id=stream_id,
                    stream_name=stream_name,
                    connector_name=connector_name,
                    severity="INFO",
                    alert_type=None,
                    last_error=None,
                    consecutive_failures=0,
                    run_id=run_id,
                    validation_run_id=validation_run_id,
                    message="Open validation alerts were resolved after a passing run.",
                    route_id=route_id,
                )
                schedule_validation_notifications(payload)
            return

        # Failure-oriented alerts (WARN caps CRITICAL).
        cf = int(validation.consecutive_failures or 0)
        last_status = str(validation.last_status)

        if had_auth_failure:
            sev: ValidationAlertSeverity = cap_severity_for_overall(overall, "CRITICAL")
            fp = fingerprint_for(int(validation.id), "AUTH_FAILURE")
            created, row = _upsert_open_alert(
                db,
                validation_id=int(validation.id),
                validation_run_id=validation_run_id,
                alert_type="AUTH_FAILURE",
                severity=sev,
                title="Validation auth failure",
                message=msg_join,
                fingerprint=fp,
            )
            _emit_notifications_if_needed(
                created_new=created,
                validation=validation,
                stream_id=stream_id,
                stream_name=stream_name,
                connector_name=connector_name,
                route_id=route_id,
                severity=str(row.severity),
                alert_type="AUTH_FAILURE",
                run_id=run_id,
                validation_run_id=validation_run_id,
                message=row.message,
                event_kind="validation_alert_opened",
            )

        if had_checkpoint_drift:
            sev = cap_severity_for_overall(overall, "CRITICAL")
            fp = fingerprint_for(int(validation.id), "CHECKPOINT_DRIFT")
            created, row = _upsert_open_alert(
                db,
                validation_id=int(validation.id),
                validation_run_id=validation_run_id,
                alert_type="CHECKPOINT_DRIFT",
                severity=sev,
                title="Checkpoint drift detected",
                message=msg_join,
                fingerprint=fp,
            )
            _emit_notifications_if_needed(
                created_new=created,
                validation=validation,
                stream_id=stream_id,
                stream_name=stream_name,
                connector_name=connector_name,
                route_id=route_id,
                severity=str(row.severity),
                alert_type="CHECKPOINT_DRIFT",
                run_id=run_id,
                validation_run_id=validation_run_id,
                message=row.message,
                event_kind="validation_alert_opened",
            )

        if int(stats.get("route_retry_failed") or 0) >= 1 and overall == "FAIL":
            sev = cap_severity_for_overall(overall, "WARNING")
            fp = fingerprint_for(int(validation.id), "RETRY_EXHAUSTED")
            created, row = _upsert_open_alert(
                db,
                validation_id=int(validation.id),
                validation_run_id=validation_run_id,
                alert_type="RETRY_EXHAUSTED",
                severity=sev,
                title="Route retries exhausted",
                message=msg_join,
                fingerprint=fp,
            )
            _emit_notifications_if_needed(
                created_new=created,
                validation=validation,
                stream_id=stream_id,
                stream_name=stream_name,
                connector_name=connector_name,
                route_id=route_id,
                severity=str(row.severity),
                alert_type="RETRY_EXHAUSTED",
                run_id=run_id,
                validation_run_id=validation_run_id,
                message=row.message,
                event_kind="validation_alert_opened",
            )

        if int(stats.get("route_send_failed") or 0) >= 1 and overall == "FAIL":
            sev = cap_severity_for_overall(overall, "WARNING")
            fp = fingerprint_for(int(validation.id), "DESTINATION_FAILURE")
            created, row = _upsert_open_alert(
                db,
                validation_id=int(validation.id),
                validation_run_id=validation_run_id,
                alert_type="DESTINATION_FAILURE",
                severity=sev,
                title="Destination delivery failure",
                message=msg_join,
                fingerprint=fp,
            )
            _emit_notifications_if_needed(
                created_new=created,
                validation=validation,
                stream_id=stream_id,
                stream_name=stream_name,
                connector_name=connector_name,
                route_id=route_id,
                severity=str(row.severity),
                alert_type="DESTINATION_FAILURE",
                run_id=run_id,
                validation_run_id=validation_run_id,
                message=row.message,
                event_kind="validation_alert_opened",
            )

        if overall == "FAIL" and any("missing delivery_logs route_send_success" in m.lower() for m in messages):
            sev = cap_severity_for_overall(overall, "WARNING")
            fp = fingerprint_for(int(validation.id), "DELIVERY_MISSING")
            created, row = _upsert_open_alert(
                db,
                validation_id=int(validation.id),
                validation_run_id=validation_run_id,
                alert_type="DELIVERY_MISSING",
                severity=sev,
                title="Delivery success log missing",
                message=msg_join,
                fingerprint=fp,
            )
            _emit_notifications_if_needed(
                created_new=created,
                validation=validation,
                stream_id=stream_id,
                stream_name=stream_name,
                connector_name=connector_name,
                route_id=route_id,
                severity=str(row.severity),
                alert_type="DELIVERY_MISSING",
                run_id=run_id,
                validation_run_id=validation_run_id,
                message=row.message,
                event_kind="validation_alert_opened",
            )

        if (
            cf >= CONSECUTIVE_FAIL_CRITICAL_THRESHOLD
            and overall == "FAIL"
            and not had_auth_failure
            and last_status == "FAILING"
        ):
            sev = cap_severity_for_overall(overall, "CRITICAL")
            fp = fingerprint_for(int(validation.id), "VALIDATION_DEGRADED", "cf_critical")
            created, row = _upsert_open_alert(
                db,
                validation_id=int(validation.id),
                validation_run_id=validation_run_id,
                alert_type="VALIDATION_DEGRADED",
                severity=sev,
                title="Validation failing persistently",
                message=f"consecutive_failures={cf}; {msg_join}",
                fingerprint=fp,
            )
            _emit_notifications_if_needed(
                created_new=created,
                validation=validation,
                stream_id=stream_id,
                stream_name=stream_name,
                connector_name=connector_name,
                route_id=route_id,
                severity=str(row.severity),
                alert_type="VALIDATION_DEGRADED",
                run_id=run_id,
                validation_run_id=validation_run_id,
                message=row.message,
                event_kind="validation_alert_opened",
            )
        elif cf >= CONSECUTIVE_FAIL_WARN_THRESHOLD and overall == "FAIL" and not had_auth_failure:
            sev = cap_severity_for_overall(overall, "WARNING")
            fp = fingerprint_for(int(validation.id), "VALIDATION_DEGRADED", "cf_warn")
            created, row = _upsert_open_alert(
                db,
                validation_id=int(validation.id),
                validation_run_id=validation_run_id,
                alert_type="VALIDATION_DEGRADED",
                severity=sev,
                title="Elevated consecutive validation failures",
                message=f"consecutive_failures={cf}; {msg_join}",
                fingerprint=fp,
            )
            _emit_notifications_if_needed(
                created_new=created,
                validation=validation,
                stream_id=stream_id,
                stream_name=stream_name,
                connector_name=connector_name,
                route_id=route_id,
                severity=str(row.severity),
                alert_type="VALIDATION_DEGRADED",
                run_id=run_id,
                validation_run_id=validation_run_id,
                message=row.message,
                event_kind="validation_alert_opened",
            )

        if (
            validation.last_failing_started_at is not None
            and last_status == "FAILING"
            and (utcnow() - validation.last_failing_started_at) >= timedelta(seconds=PROLONGED_FAILING_SECONDS)
        ):
            sev = cap_severity_for_overall(overall, "WARNING")
            fp = fingerprint_for(int(validation.id), "VALIDATION_TIMEOUT")
            created, row = _upsert_open_alert(
                db,
                validation_id=int(validation.id),
                validation_run_id=validation_run_id,
                alert_type="VALIDATION_TIMEOUT",
                severity=sev,
                title="Validation remains failing beyond threshold window",
                message=f"last_failing_started_at={validation.last_failing_started_at.isoformat()}; {msg_join}",
                fingerprint=fp,
            )
            _emit_notifications_if_needed(
                created_new=created,
                validation=validation,
                stream_id=stream_id,
                stream_name=stream_name,
                connector_name=connector_name,
                route_id=route_id,
                severity=str(row.severity),
                alert_type="VALIDATION_TIMEOUT",
                run_id=run_id,
                validation_run_id=validation_run_id,
                message=row.message,
                event_kind="validation_alert_opened",
            )

        if int(latency_ms) >= 600_000 and overall != "PASS":
            sev = cap_severity_for_overall(overall, "WARNING")
            fp = fingerprint_for(int(validation.id), "VALIDATION_TIMEOUT", "slow_run")
            created, row = _upsert_open_alert(
                db,
                validation_id=int(validation.id),
                validation_run_id=validation_run_id,
                alert_type="VALIDATION_TIMEOUT",
                severity=sev,
                title="Validation run duration exceeded slow threshold",
                message=f"latency_ms={latency_ms}; {msg_join}",
                fingerprint=fp,
            )
            _emit_notifications_if_needed(
                created_new=created,
                validation=validation,
                stream_id=stream_id,
                stream_name=stream_name,
                connector_name=connector_name,
                route_id=route_id,
                severity=str(row.severity),
                alert_type="VALIDATION_TIMEOUT",
                run_id=run_id,
                validation_run_id=validation_run_id,
                message=row.message,
                event_kind="validation_alert_opened",
            )

    except Exception as exc:  # pragma: no cover - fail-open
        logger.error(
            "%s",
            {
                "stage": "validation_alert_cycle_failed",
                "validation_id": int(validation.id),
                "error_type": type(exc).__name__,
                "message": str(exc),
            },
        )


def list_alerts(
    db: Session,
    *,
    status: str | None = None,
    validation_id: int | None = None,
    limit: int = 100,
) -> list[ValidationAlert]:
    lim = min(max(int(limit), 1), 500)
    stmt = select(ValidationAlert)
    if status:
        stmt = stmt.where(ValidationAlert.status == str(status))
    if validation_id is not None:
        stmt = stmt.where(ValidationAlert.validation_id == int(validation_id))
    stmt = stmt.order_by(ValidationAlert.id.desc()).limit(lim)
    return list(db.scalars(stmt).all())


def get_alert(db: Session, alert_id: int) -> ValidationAlert | None:
    return db.get(ValidationAlert, int(alert_id))


def acknowledge_alert(db: Session, alert_id: int) -> ValidationAlert | None:
    row = db.get(ValidationAlert, int(alert_id))
    if row is None or str(row.status) != "OPEN":
        return row
    row.status = "ACKNOWLEDGED"
    row.acknowledged_at = utcnow()
    db.commit()
    db.refresh(row)
    return row


def resolve_alert_manual(db: Session, alert_id: int) -> ValidationAlert | None:
    row = db.get(ValidationAlert, int(alert_id))
    if row is None or str(row.status) == "RESOLVED":
        return row
    row.status = "RESOLVED"
    row.resolved_at = utcnow()
    db.commit()
    db.refresh(row)
    return row


def alert_row_to_read_dict(row: ValidationAlert) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "validation_id": int(row.validation_id),
        "validation_run_id": int(row.validation_run_id) if row.validation_run_id is not None else None,
        "severity": str(row.severity),
        "alert_type": str(row.alert_type),
        "status": str(row.status),
        "title": str(row.title),
        "message": str(row.message),
        "fingerprint": str(row.fingerprint),
        "triggered_at": row.triggered_at,
        "acknowledged_at": row.acknowledged_at,
        "resolved_at": row.resolved_at,
        "created_at": row.created_at,
    }


def build_failures_summary(db: Session, *, limit: int = 50) -> dict[str, Any]:
    failing = int(
        db.scalar(select(func.count()).select_from(ContinuousValidation).where(ContinuousValidation.last_status == "FAILING"))
        or 0
    )
    degraded = int(
        db.scalar(select(func.count()).select_from(ContinuousValidation).where(ContinuousValidation.last_status == "DEGRADED"))
        or 0
    )
    open_crit = int(
        db.scalar(
            select(func.count()).select_from(ValidationAlert).where(
                ValidationAlert.status == "OPEN",
                ValidationAlert.severity == "CRITICAL",
            )
        )
        or 0
    )
    open_warn = int(
        db.scalar(
            select(func.count()).select_from(ValidationAlert).where(
                ValidationAlert.status == "OPEN",
                ValidationAlert.severity == "WARNING",
            )
        )
        or 0
    )
    open_info = int(
        db.scalar(
            select(func.count()).select_from(ValidationAlert).where(
                ValidationAlert.status == "OPEN",
                ValidationAlert.severity == "INFO",
            )
        )
        or 0
    )

    def _open_count(alert_type: str) -> int:
        return int(
            db.scalar(
                select(func.count()).select_from(ValidationAlert).where(
                    ValidationAlert.status == "OPEN",
                    ValidationAlert.alert_type == alert_type,
                )
            )
            or 0
        )

    latest = list(
        db.scalars(
            select(ValidationAlert)
            .where(ValidationAlert.status == "OPEN")
            .order_by(ValidationAlert.id.desc())
            .limit(int(limit))
        ).all()
    )
    return {
        "failing_validations_count": failing,
        "degraded_validations_count": degraded,
        "open_alerts_critical": open_crit,
        "open_alerts_warning": open_warn,
        "open_alerts_info": open_info,
        "open_auth_failure_alerts": _open_count("AUTH_FAILURE"),
        "open_delivery_failure_alerts": _open_count("DESTINATION_FAILURE") + _open_count("DELIVERY_MISSING"),
        "open_checkpoint_drift_alerts": _open_count("CHECKPOINT_DRIFT"),
        "latest_open_alerts": [alert_row_to_read_dict(a) for a in latest],
    }
