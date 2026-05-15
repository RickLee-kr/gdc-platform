"""Read-only aggregates for runtime / dashboard validation health (no StreamRunner coupling)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.validation.alert_service import build_failures_summary
from app.validation.models import ValidationRecoveryEvent, ValidationRun


def list_recovery_events(db: Session, *, validation_id: int | None = None, limit: int = 50) -> list[ValidationRecoveryEvent]:
    lim = min(max(int(limit), 1), 500)
    stmt = select(ValidationRecoveryEvent).order_by(ValidationRecoveryEvent.id.desc()).limit(lim)
    if validation_id is not None:
        stmt = stmt.where(ValidationRecoveryEvent.validation_id == int(validation_id))
    return list(db.scalars(stmt).all())


def validation_outcome_trend_buckets(db: Session, *, hours: int = 24) -> list[dict[str, Any]]:
    """Hourly PASS/FAIL/WARN counts from validation_runs (runner_summary rows preferred)."""

    since = datetime.now(timezone.utc) - timedelta(hours=int(hours))
    bucket = func.date_trunc("hour", ValidationRun.created_at).label("bucket")
    stmt = (
        select(
            bucket,
            func.sum(case((ValidationRun.status == "PASS", 1), else_=0)).label("pass_count"),
            func.sum(case((ValidationRun.status == "FAIL", 1), else_=0)).label("fail_count"),
            func.sum(case((ValidationRun.status == "WARN", 1), else_=0)).label("warn_count"),
        )
        .where(ValidationRun.created_at >= since, ValidationRun.validation_stage == "runner_summary")
        .group_by(bucket)
        .order_by(bucket.asc())
    )
    rows = db.execute(stmt).all()
    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "bucket_start": r.bucket,
                "pass_count": int(r.pass_count or 0),
                "fail_count": int(r.fail_count or 0),
                "warn_count": int(r.warn_count or 0),
            }
        )
    return out


def _recovery_to_dict(ev: ValidationRecoveryEvent) -> dict[str, Any]:
    return {
        "id": int(ev.id),
        "validation_id": int(ev.validation_id),
        "validation_run_id": int(ev.validation_run_id) if ev.validation_run_id is not None else None,
        "category": str(ev.category),
        "title": str(ev.title),
        "message": str(ev.message),
        "created_at": ev.created_at,
    }


def build_validation_operational_summary(db: Session, *, failures_limit: int = 20) -> dict[str, Any]:
    base = build_failures_summary(db, limit=failures_limit)
    recoveries = list_recovery_events(db, limit=8)
    trend = validation_outcome_trend_buckets(db, hours=24)
    return {
        **base,
        "latest_recoveries": [_recovery_to_dict(r) for r in recoveries],
        "outcome_trend_24h": trend,
    }
