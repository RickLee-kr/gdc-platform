"""Dynamic routing delivery_logs metrics (bounded reads)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dynamic_routing.dynamic_routing_engine import DynamicRoutingBatchResult
from app.dynamic_routing.models import StreamDynamicRoute
from app.platform_summary.stage_metrics import (
    load_latest_stage_metrics,
    load_latest_stage_row,
    load_recent_stage_rows,
)

DYNAMIC_ROUTING_COMPLETE_STAGE = "dynamic_routing_complete"
_DEFAULT_RECENT_LOG_LIMIT = 500


def _cumulative_int(sample: dict[str, Any], *keys: str) -> int:
    for key in keys:
        if key in sample:
            return max(0, int(sample.get(key) or 0))
    return 0


def load_cumulative_dynamic_delivery_totals(db: Session, stream_id: int) -> dict[str, int]:
    row = load_latest_stage_row(
        db,
        stream_id=int(stream_id),
        stage=DYNAMIC_ROUTING_COMPLETE_STAGE,
    )
    if row is None:
        return {"dynamic_deliveries": 0, "matched_dynamic_routes": 0}
    sample = row.payload_sample if isinstance(row.payload_sample, dict) else {}
    return {
        "dynamic_deliveries": _cumulative_int(
            sample, "total_dynamic_deliveries", "dynamic_deliveries"
        ),
        "matched_dynamic_routes": _cumulative_int(
            sample, "total_matched_dynamic_routes", "matched_dynamic_routes"
        ),
    }


def build_dynamic_routing_complete_payload(
    *,
    stream_id: int,
    result: DynamicRoutingBatchResult,
    dynamic_deliveries_this_run: int = 0,
    cumulative_totals: dict[str, int] | None = None,
) -> dict[str, Any]:
    processing_time_ms = max(0, int(result.duration_ms or 0))
    matched_this_run = max(0, int(result.matched_dynamic_route_count or 0))
    deliveries_this_run = max(0, int(dynamic_deliveries_this_run))
    prev_matched = int((cumulative_totals or {}).get("matched_dynamic_routes") or 0)
    prev_deliveries = int((cumulative_totals or {}).get("dynamic_deliveries") or 0)
    total_matched = prev_matched + matched_this_run
    total_deliveries = prev_deliveries + deliveries_this_run

    return {
        "stage": DYNAMIC_ROUTING_COMPLETE_STAGE,
        "stream_id": stream_id,
        "message": "dynamic routing evaluation complete",
        "dynamic_route_count": int(result.dynamic_route_count or 0),
        "matched_dynamic_route_count": matched_this_run,
        "selected_destination_count": max(0, int(result.selected_destination_count or 0)),
        "processing_time_ms": processing_time_ms,
        "latency_ms": processing_time_ms,
        "dynamic_deliveries_this_run": deliveries_this_run,
        "matched_dynamic_routes": total_matched,
        "dynamic_deliveries": total_deliveries,
        "total_matched_dynamic_routes": total_matched,
        "total_dynamic_deliveries": total_deliveries,
    }


def load_dynamic_routing_runtime_metrics(
    db: Session,
    stream_id: int,
    *,
    total_dynamic_routes: int,
    recent_log_limit: int = _DEFAULT_RECENT_LOG_LIMIT,
) -> dict[str, Any]:
    latest = load_latest_stage_row(
        db,
        stream_id=int(stream_id),
        stage=DYNAMIC_ROUTING_COMPLETE_STAGE,
    )
    if latest is not None:
        sample = latest.payload_sample if isinstance(latest.payload_sample, dict) else {}
        if any(
            key in sample
            for key in (
                "dynamic_deliveries",
                "matched_dynamic_routes",
                "total_dynamic_deliveries",
                "total_matched_dynamic_routes",
            )
        ):
            return {
                "total_dynamic_routes": max(0, int(total_dynamic_routes)),
                "matched_dynamic_routes": _cumulative_int(
                    sample, "total_matched_dynamic_routes", "matched_dynamic_routes"
                ),
                "dynamic_deliveries": _cumulative_int(
                    sample, "total_dynamic_deliveries", "dynamic_deliveries"
                ),
                "last_evaluated_at": latest.created_at,
            }

    rows = load_recent_stage_rows(
        db,
        stream_id=int(stream_id),
        stage=DYNAMIC_ROUTING_COMPLETE_STAGE,
        limit=recent_log_limit,
    )
    matched = 0
    deliveries = 0
    last_at: datetime | None = None
    for row in rows:
        sample = row.payload_sample if isinstance(row.payload_sample, dict) else {}
        matched += max(0, int(sample.get("matched_dynamic_route_count") or 0))
        deliveries += max(0, int(sample.get("matched_dynamic_route_count") or 0))
        if last_at is None:
            last_at = row.created_at
    return {
        "total_dynamic_routes": max(0, int(total_dynamic_routes)),
        "matched_dynamic_routes": matched,
        "dynamic_deliveries": deliveries,
        "last_evaluated_at": last_at,
    }


def build_platform_dynamic_routing_summary(db: Session) -> dict[str, int]:
    total_dynamic_routes = int(
        db.execute(select(func.count()).select_from(StreamDynamicRoute)).scalar_one() or 0
    )
    latest_rows = load_latest_stage_metrics(db, stage=DYNAMIC_ROUTING_COMPLETE_STAGE)
    matched_dynamic_routes = 0
    dynamic_deliveries = 0
    for row in latest_rows:
        sample = row.payload_sample if isinstance(row.payload_sample, dict) else {}
        if any(
            key in sample
            for key in (
                "dynamic_deliveries",
                "matched_dynamic_routes",
                "total_dynamic_deliveries",
                "total_matched_dynamic_routes",
            )
        ):
            matched_dynamic_routes += _cumulative_int(
                sample, "total_matched_dynamic_routes", "matched_dynamic_routes"
            )
            dynamic_deliveries += _cumulative_int(
                sample, "total_dynamic_deliveries", "dynamic_deliveries"
            )
            continue
        matched_dynamic_routes += max(0, int(sample.get("matched_dynamic_route_count") or 0))
        dynamic_deliveries += max(0, int(sample.get("dynamic_deliveries_this_run") or 0))
    return {
        "total_dynamic_routes": total_dynamic_routes,
        "matched_dynamic_routes": matched_dynamic_routes,
        "dynamic_deliveries": dynamic_deliveries,
    }
