"""AI Gateway traffic metrics aggregated from delivery_logs."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.destinations.models import Destination
from app.failover_routing.failover_metrics import (
    FAILOVER_ROUTE_ATTEMPT_STAGE,
    load_cumulative_failover_totals,
)
from app.logs.models import DeliveryLog
from app.ai_audit.service import build_ai_audit_metrics
from app.replay.metrics import REPLAY_EVENT_REPLAYED_STAGE
from app.replay.models import StreamReplayEvent

_SUCCESS_STAGES = frozenset({"route_send_success", "failover_route_send_success", "dynamic_route_send_success"})
_FAILURE_STAGES = frozenset({"route_send_failed", "failover_route_send_failed", "dynamic_route_send_failed"})


def _ai_destination_provider_map(db: Session) -> dict[int, int]:
    rows = db.execute(
        select(Destination.id, Destination.config_json).where(Destination.destination_type == "AI_PROVIDER_POST")
    ).all()
    out: dict[int, int] = {}
    for dest_id, cfg in rows:
        if not isinstance(cfg, dict):
            continue
        provider_id = cfg.get("provider_id")
        try:
            out[int(dest_id)] = int(provider_id)
        except (TypeError, ValueError):
            continue
    return out


def _window_start(hours: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(hours=max(1, min(int(hours), 168)))


def build_ai_traffic_summary(db: Session, *, hours: int = 24, stream_id: int | None = None) -> dict[str, Any]:
    since = _window_start(hours)
    provider_by_dest = _ai_destination_provider_map(db)
    ai_dest_ids = list(provider_by_dest.keys())
    if not ai_dest_ids:
        return _empty_summary(hours=hours, stream_id=stream_id)

    stmt = select(DeliveryLog).where(
        DeliveryLog.created_at >= since,
        DeliveryLog.destination_id.in_(ai_dest_ids),
        DeliveryLog.stage.in_(sorted(_SUCCESS_STAGES | _FAILURE_STAGES)),
    )
    if stream_id is not None:
        stmt = stmt.where(DeliveryLog.stream_id == int(stream_id))
    rows = list(db.execute(stmt).scalars())

    request_count = len(rows)
    success_count = sum(1 for row in rows if str(row.stage) in _SUCCESS_STAGES)
    failure_count = sum(1 for row in rows if str(row.stage) in _FAILURE_STAGES)
    latencies = [int(row.latency_ms) for row in rows if row.latency_ms is not None]
    avg_latency_ms = int(sum(latencies) / len(latencies)) if latencies else 0

    provider_stats: dict[int, dict[str, Any]] = {}
    for row in rows:
        dest_id = int(row.destination_id or 0)
        provider_id = provider_by_dest.get(dest_id)
        if provider_id is None:
            continue
        bucket = provider_stats.setdefault(
            provider_id,
            {"provider_id": provider_id, "request_count": 0, "success_count": 0, "failure_count": 0, "latencies": []},
        )
        bucket["request_count"] += 1
        if str(row.stage) in _SUCCESS_STAGES:
            bucket["success_count"] += 1
        else:
            bucket["failure_count"] += 1
        if row.latency_ms is not None:
            bucket["latencies"].append(int(row.latency_ms))

    top_providers: list[dict[str, Any]] = []
    for provider_id, bucket in provider_stats.items():
        lat = bucket.pop("latencies", [])
        avg = int(sum(lat) / len(lat)) if lat else 0
        top_providers.append(
            {
                "provider_id": provider_id,
                "request_count": int(bucket["request_count"]),
                "success_count": int(bucket["success_count"]),
                "failure_count": int(bucket["failure_count"]),
                "avg_latency_ms": avg,
            }
        )
    top_providers.sort(key=lambda item: int(item["request_count"]), reverse=True)

    failover_count = 0
    replay_count = 0
    if stream_id is not None:
        failover_count = int(load_cumulative_failover_totals(db, int(stream_id)).get("failover_attempts") or 0)
        replay_count = int(
            db.execute(
                select(func.count(StreamReplayEvent.id)).where(
                    StreamReplayEvent.stream_id == int(stream_id),
                    StreamReplayEvent.status == "REPLAYED",
                    StreamReplayEvent.updated_at >= since,
                )
            ).scalar_one()
            or 0
        )
    else:
        failover_count = int(
            db.execute(
                select(func.count(DeliveryLog.id)).where(
                    DeliveryLog.created_at >= since,
                    DeliveryLog.stage == FAILOVER_ROUTE_ATTEMPT_STAGE,
                )
            ).scalar_one()
            or 0
        )
        replay_count = int(
            db.execute(
                select(func.count(StreamReplayEvent.id)).where(
                    StreamReplayEvent.status == "REPLAYED",
                    StreamReplayEvent.updated_at >= since,
                )
            ).scalar_one()
            or 0
        )

    success_rate = round((success_count / request_count) * 100.0, 2) if request_count else 0.0
    error_rate = round((failure_count / request_count) * 100.0, 2) if request_count else 0.0

    audit_metrics = build_ai_audit_metrics(db, hours=hours, stream_id=stream_id)
    audit_totals = dict(audit_metrics.get("totals") or {})

    return {
        "window_hours": int(hours),
        "stream_id": stream_id,
        "requests": request_count,
        "success_count": success_count,
        "failure_count": failure_count,
        "success_rate": success_rate,
        "error_rate": error_rate,
        "avg_latency_ms": avg_latency_ms,
        "top_providers": top_providers[:10],
        "failover_count": failover_count,
        "replay_count": replay_count,
        "inspected_count": int(audit_totals.get("inspected_count") or 0),
        "blocked_count": int(audit_totals.get("blocked_count") or 0),
        "masked_count": int(audit_totals.get("masked_count") or 0),
        "redacted_count": int(audit_totals.get("redacted_count") or 0),
        "policy_blocks": int(audit_totals.get("blocked_count") or 0),
        "prompt_masks": int(audit_totals.get("prompt_mask_count") or 0),
        "response_masks": int(audit_totals.get("response_mask_count") or 0),
    }


def _empty_summary(*, hours: int, stream_id: int | None) -> dict[str, Any]:
    return {
        "window_hours": int(hours),
        "stream_id": stream_id,
        "requests": 0,
        "success_count": 0,
        "failure_count": 0,
        "success_rate": 0.0,
        "error_rate": 0.0,
        "avg_latency_ms": 0,
        "top_providers": [],
        "failover_count": 0,
        "replay_count": 0,
        "inspected_count": 0,
        "blocked_count": 0,
        "masked_count": 0,
        "redacted_count": 0,
        "policy_blocks": 0,
        "prompt_masks": 0,
        "response_masks": 0,
    }
