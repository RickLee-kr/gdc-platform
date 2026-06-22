"""Read-only aggregates for runtime / dashboard validation health (no StreamRunner coupling)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.validation.alert_service import build_failures_summary
from app.validation.models import ValidationRecoveryEvent
from app.validation.runtime_incidents import ScoringMode, build_current_runtime_operational_incidents

logger = logging.getLogger(__name__)

_MAX_TREND_HOURS = 24
_TREND_STATEMENT_TIMEOUT_MS = 800
_TREND_MAX_VALIDATION_IDS = 500
_RUNNER_SUMMARY_STAGE = "runner_summary"
UTC = timezone.utc


def list_recovery_events(db: Session, *, validation_id: int | None = None, limit: int = 50) -> list[ValidationRecoveryEvent]:
    lim = min(max(int(limit), 1), 500)
    stmt = select(ValidationRecoveryEvent).order_by(ValidationRecoveryEvent.id.desc()).limit(lim)
    if validation_id is not None:
        stmt = stmt.where(ValidationRecoveryEvent.validation_id == int(validation_id))
    return list(db.scalars(stmt).all())


def _resolve_validation_ids(db: Session) -> list[int]:
    """Bounded validation id list for scoped validation_runs trend reads."""

    rows = db.execute(
        text("SELECT id FROM continuous_validations ORDER BY id ASC LIMIT :lim"),
        {"lim": int(_TREND_MAX_VALIDATION_IDS)},
    ).fetchall()
    return [int(r[0]) for r in rows]


def validation_outcome_trend_buckets(db: Session, *, hours: int = 24) -> list[dict[str, Any]]:
    """Hourly PASS/FAIL/WARN counts from validation_runs (runner_summary rows only).

    Scoped to configured validation ids and at most the last 24 hours. Uses
    ``validation_id`` + ``created_at`` index paths; selects aggregate columns only.
    """

    bounded_hours = min(max(int(hours), 1), _MAX_TREND_HOURS)
    until = datetime.now(UTC)
    since = until - timedelta(hours=bounded_hours)
    validation_ids = _resolve_validation_ids(db)
    if not validation_ids:
        return []

    sql = text(
        """
        SELECT
            date_trunc('hour', created_at) AS bucket,
            COUNT(*) FILTER (WHERE status = 'PASS') AS pass_count,
            COUNT(*) FILTER (WHERE status = 'FAIL') AS fail_count,
            COUNT(*) FILTER (WHERE status = 'WARN') AS warn_count
        FROM validation_runs
        WHERE validation_id = ANY(:validation_ids)
          AND created_at >= :since
          AND created_at < :until
          AND validation_stage = :stage
        GROUP BY 1
        ORDER BY 1 ASC
        """
    )
    params = {
        "validation_ids": validation_ids,
        "since": since,
        "until": until,
        "stage": _RUNNER_SUMMARY_STAGE,
    }
    rows: tuple = ()
    try:
        db.execute(text(f"SET LOCAL statement_timeout = '{int(_TREND_STATEMENT_TIMEOUT_MS)}ms'"))
        rows = db.execute(sql, params).fetchall()
    except OperationalError:
        db.rollback()
        logger.warning(
            "validation_trend_degraded",
            extra={"stage": "validation_trend_degraded"},
        )
        raise
    finally:
        try:
            db.execute(text("SET LOCAL statement_timeout = '0'"))
        except OperationalError:
            db.rollback()

    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "bucket_start": r[0],
                "pass_count": int(r[1] or 0),
                "fail_count": int(r[2] or 0),
                "warn_count": int(r[3] or 0),
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


def build_validation_operational_summary(
    db: Session,
    *,
    failures_limit: int = 20,
    scoring_mode: ScoringMode = "current_runtime",
    window: str | None = "1h",
) -> dict[str, Any]:
    recoveries = list_recovery_events(db, limit=8)
    trend_degraded = False
    try:
        trend = validation_outcome_trend_buckets(db, hours=24)
    except OperationalError:
        db.rollback()
        trend = []
        trend_degraded = True
    if scoring_mode == "current_runtime":
        base = build_current_runtime_operational_incidents(
            db, window=window, failures_limit=failures_limit
        )
    else:
        base = build_failures_summary(db, limit=failures_limit)
        base["scoring_mode"] = "historical_analytics"
    return {
        **base,
        "latest_recoveries": [_recovery_to_dict(r) for r in recoveries],
        "outcome_trend_24h": trend,
        "degraded": bool(trend_degraded or base.get("degraded")),
    }
