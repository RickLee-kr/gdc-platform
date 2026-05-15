"""Admin health summary from existing DB signals (no synthetic metrics)."""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.logs.models import DeliveryLog
from app.streams.models import Stream

_WINDOW = timedelta(hours=1)
# destination latency: successful sends only
_LATENCY_STAGES = ("route_send_success", "route_retry_success")
_SUCCESS_STAGES = ("route_send_success", "route_retry_success")
_FAIL_STAGES = ("route_send_failed", "route_retry_failed", "route_unknown_failure_policy")


def _since() -> datetime:
    return datetime.now(timezone.utc) - _WINDOW


def _status_from_failure_rate(rate: float) -> Literal["good", "medium", "bad"]:
    if rate < 0.01:
        return "good"
    if rate < 0.05:
        return "medium"
    return "bad"


def build_admin_health_summary(db: Session) -> dict[str, Any]:
    since = _since()

    t0 = time.perf_counter()
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
        db_ms = round((time.perf_counter() - t0) * 1000.0, 1)
    except Exception:
        db_ok = False
        db_ms = None

    p95_dest = db.scalar(
        select(func.percentile_cont(0.95).within_group(DeliveryLog.latency_ms))
        .where(
            DeliveryLog.created_at >= since,
            DeliveryLog.stage.in_(_LATENCY_STAGES),
            DeliveryLog.latency_ms.isnot(None),
            DeliveryLog.latency_ms >= 0,
        )
    )
    dest_lat_ok = p95_dest is not None
    dest_lat = float(p95_dest) if dest_lat_ok else None

    http_429 = int(
        db.scalar(
            select(func.count())
            .select_from(DeliveryLog)
            .where(DeliveryLog.created_at >= since, DeliveryLog.http_status == 429)
        )
        or 0
    )

    succ_ev = int(
        db.scalar(
            select(func.count())
            .select_from(DeliveryLog)
            .where(DeliveryLog.created_at >= since, DeliveryLog.stage.in_(_SUCCESS_STAGES))
        )
        or 0
    )
    fail_ev = int(
        db.scalar(
            select(func.count()).select_from(DeliveryLog).where(DeliveryLog.created_at >= since, DeliveryLog.stage.in_(_FAIL_STAGES))
        )
        or 0
    )
    outcome_total = succ_ev + fail_ev
    failure_rate = (fail_ev / outcome_total) if outcome_total > 0 else None

    now = datetime.now(timezone.utc)
    last_cp_at = db.scalar(
        select(func.max(Checkpoint.updated_at))
        .select_from(Checkpoint)
        .join(Stream, Stream.id == Checkpoint.stream_id)
        .where(Stream.enabled.is_(True), Stream.status == "RUNNING")
    )
    stream_lag_seconds: float | None = None
    if last_cp_at is not None:
        stream_lag_seconds = max(0.0, (now - last_cp_at).total_seconds())
    stream_lag_ok = last_cp_at is not None

    metrics: list[dict[str, Any]] = [
        {
            "key": "db_latency_ms",
            "label": "DB latency (avg sample)",
            "available": db_ok,
            "value": f"{db_ms} ms" if db_ms is not None else None,
            "status": "good" if db_ok and db_ms is not None and db_ms < 200 else ("medium" if db_ok else "unknown"),
            "link_path": None,
        },
        {
            "key": "queue_delay_p95",
            "label": "Queue delay (p95)",
            "available": False,
            "value": None,
            "status": "unknown",
            "notes": "Not available — no internal queue metrics exposed yet.",
            "link_path": "/runtime",
        },
        {
            "key": "stream_lag_max",
            "label": "Stream lag (checkpoint age, max)",
            "available": stream_lag_ok and stream_lag_seconds is not None,
            "value": f"{stream_lag_seconds / 60:.1f} min" if stream_lag_seconds is not None else None,
            "status": "good"
            if stream_lag_seconds is not None and stream_lag_seconds < 300
            else ("medium" if stream_lag_seconds is not None and stream_lag_seconds < 900 else ("bad" if stream_lag_seconds is not None else "unknown")),
            "link_path": "/runtime",
        },
        {
            "key": "destination_latency_p95",
            "label": "Destination latency (p95, successful sends)",
            "available": dest_lat_ok,
            "value": f"{int(dest_lat)} ms" if dest_lat is not None else None,
            "status": "good"
            if dest_lat is not None and dest_lat < 800
            else ("medium" if dest_lat is not None and dest_lat < 2000 else ("bad" if dest_lat is not None else "unknown")),
            "link_path": "/runtime/analytics",
        },
        {
            "key": "http_429_count_1h",
            "label": "HTTP 429 count (1h, delivery_logs)",
            "available": True,
            "value": str(http_429),
            "status": "good" if http_429 == 0 else ("medium" if http_429 < 20 else "bad"),
            "link_path": "/runtime/analytics",
        },
        {
            "key": "failure_rate_1h",
            "label": "Failure rate (1h, pipeline stages)",
            "available": failure_rate is not None,
            "value": f"{failure_rate * 100:.2f}%" if failure_rate is not None else None,
            "status": _status_from_failure_rate(failure_rate) if failure_rate is not None else "unknown",
            "link_path": "/runtime/analytics",
        },
    ]

    return {"metrics_window_seconds": int(_WINDOW.total_seconds()), "metrics": metrics}
