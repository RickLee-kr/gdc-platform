"""Failover routing delivery_logs metrics (bounded reads)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Callable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.failover_routing.models import StreamFailoverRoute
from app.platform_summary.stage_metrics import (
    load_latest_stage_metrics,
    load_latest_stage_row,
    load_recent_stage_rows,
)

FAILOVER_ROUTING_COMPLETE_STAGE = "failover_routing_complete"
FAILOVER_ROUTE_ATTEMPT_STAGE = "failover_route_attempt"
FAILOVER_ROUTE_SEND_SUCCESS_STAGE = "failover_route_send_success"
FAILOVER_ROUTE_SEND_FAILED_STAGE = "failover_route_send_failed"
_DEFAULT_RECENT_LOG_LIMIT = 500


def _cumulative_int(sample: dict[str, Any], *keys: str) -> int:
    for key in keys:
        if key in sample:
            return max(0, int(sample.get(key) or 0))
    return 0


def load_cumulative_failover_totals(db: Session, stream_id: int) -> dict[str, int]:
    row = load_latest_stage_row(
        db,
        stream_id=int(stream_id),
        stage=FAILOVER_ROUTING_COMPLETE_STAGE,
    )
    if row is None:
        return {"failover_attempts": 0, "failover_successes": 0, "failover_failures": 0}
    sample = row.payload_sample if isinstance(row.payload_sample, dict) else {}
    return {
        "failover_attempts": _cumulative_int(sample, "total_failover_attempts", "failover_attempts"),
        "failover_successes": _cumulative_int(sample, "total_failover_successes", "failover_successes"),
        "failover_failures": _cumulative_int(sample, "total_failover_failures", "failover_failures"),
    }


def build_failover_routing_complete_payload(
    *,
    stream_id: int,
    failover_route_count: int,
    attempt_count: int,
    success_count: int,
    failure_count: int,
    processing_time_ms: int,
    cumulative_totals: dict[str, int] | None = None,
) -> dict[str, Any]:
    prev_attempts = int((cumulative_totals or {}).get("failover_attempts") or 0)
    prev_successes = int((cumulative_totals or {}).get("failover_successes") or 0)
    prev_failures = int((cumulative_totals or {}).get("failover_failures") or 0)
    total_attempts = prev_attempts + max(0, int(attempt_count))
    total_successes = prev_successes + max(0, int(success_count))
    total_failures = prev_failures + max(0, int(failure_count))

    processing_time_ms = max(0, int(processing_time_ms))
    return {
        "stage": FAILOVER_ROUTING_COMPLETE_STAGE,
        "stream_id": stream_id,
        "message": "failover routing evaluation complete",
        "failover_route_count": max(0, int(failover_route_count)),
        "attempt_count": max(0, int(attempt_count)),
        "success_count": max(0, int(success_count)),
        "failure_count": max(0, int(failure_count)),
        "processing_time_ms": processing_time_ms,
        "latency_ms": processing_time_ms,
        "failover_attempts": total_attempts,
        "failover_successes": total_successes,
        "failover_failures": total_failures,
        "total_failover_attempts": total_attempts,
        "total_failover_successes": total_successes,
        "total_failover_failures": total_failures,
    }


def load_failover_routing_runtime_metrics(
    db: Session,
    stream_id: int,
    *,
    total_failover_routes: int,
    recent_log_limit: int = _DEFAULT_RECENT_LOG_LIMIT,
) -> dict[str, Any]:
    latest = load_latest_stage_row(
        db,
        stream_id=int(stream_id),
        stage=FAILOVER_ROUTING_COMPLETE_STAGE,
    )
    if latest is not None:
        sample = latest.payload_sample if isinstance(latest.payload_sample, dict) else {}
        if any(
            key in sample
            for key in (
                "failover_attempts",
                "failover_successes",
                "failover_failures",
                "total_failover_attempts",
                "total_failover_successes",
                "total_failover_failures",
            )
        ):
            return {
                "total_failover_routes": max(0, int(total_failover_routes)),
                "failover_attempts": _cumulative_int(sample, "total_failover_attempts", "failover_attempts"),
                "failover_successes": _cumulative_int(sample, "total_failover_successes", "failover_successes"),
                "failover_failures": _cumulative_int(sample, "total_failover_failures", "failover_failures"),
                "last_evaluated_at": latest.created_at,
            }

    rows = load_recent_stage_rows(
        db,
        stream_id=int(stream_id),
        stage=FAILOVER_ROUTING_COMPLETE_STAGE,
        limit=recent_log_limit,
    )
    attempts = 0
    successes = 0
    failures = 0
    last_at: datetime | None = None
    for row in rows:
        sample = row.payload_sample if isinstance(row.payload_sample, dict) else {}
        attempts += max(0, int(sample.get("attempt_count") or 0))
        successes += max(0, int(sample.get("success_count") or 0))
        failures += max(0, int(sample.get("failure_count") or 0))
        if last_at is None:
            last_at = row.created_at
    return {
        "total_failover_routes": max(0, int(total_failover_routes)),
        "failover_attempts": attempts,
        "failover_successes": successes,
        "failover_failures": failures,
        "last_evaluated_at": last_at,
    }


def build_platform_failover_routing_summary(db: Session) -> dict[str, int]:
    total_failover_routes = int(
        db.execute(select(func.count()).select_from(StreamFailoverRoute)).scalar_one() or 0
    )
    latest_rows = load_latest_stage_metrics(db, stage=FAILOVER_ROUTING_COMPLETE_STAGE)
    failover_attempts = 0
    failover_successes = 0
    failover_failures = 0
    for row in latest_rows:
        sample = row.payload_sample if isinstance(row.payload_sample, dict) else {}
        if any(
            key in sample
            for key in (
                "failover_attempts",
                "failover_successes",
                "failover_failures",
                "total_failover_attempts",
                "total_failover_successes",
                "total_failover_failures",
            )
        ):
            failover_attempts += _cumulative_int(sample, "total_failover_attempts", "failover_attempts")
            failover_successes += _cumulative_int(sample, "total_failover_successes", "failover_successes")
            failover_failures += _cumulative_int(sample, "total_failover_failures", "failover_failures")
            continue
        failover_attempts += max(0, int(sample.get("attempt_count") or 0))
        failover_successes += max(0, int(sample.get("success_count") or 0))
        failover_failures += max(0, int(sample.get("failure_count") or 0))
    return {
        "total_failover_routes": total_failover_routes,
        "failover_attempts": failover_attempts,
        "failover_successes": failover_successes,
        "failover_failures": failover_failures,
    }


def log_failover_routing_complete(
    db: Session | None,
    *,
    stream_id: int,
    failover_route_count: int,
    attempt_count: int,
    success_count: int,
    failure_count: int,
    processing_time_ms: int,
    log_fn: Callable[[dict[str, Any]], None],
) -> None:
    cumulative: dict[str, int] | None = None
    if db is not None:
        cumulative = load_cumulative_failover_totals(db, stream_id)
    payload = build_failover_routing_complete_payload(
        stream_id=stream_id,
        failover_route_count=failover_route_count,
        attempt_count=attempt_count,
        success_count=success_count,
        failure_count=failure_count,
        processing_time_ms=processing_time_ms,
        cumulative_totals=cumulative,
    )
    log_fn(payload)
