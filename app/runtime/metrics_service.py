"""Aggregated stream runtime metrics for the Stream Runtime UI (read-only)."""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from typing import Any, Literal

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.checkpoints.models import Checkpoint
from app.logs.aggregates import (
    aggregate_route_trend_buckets,
    aggregate_route_window_stats,
    aggregate_stream_delivery_buckets,
    dense_route_trend_series,
    dense_stream_delivery_buckets,
    latest_failure_messages_for_stream,
)
from app.logs.models import DeliveryLog
from app.routes.models import Route
from app.runtime.metrics_window import (
    bucket_seconds_for_window,
    max_buckets_for_window,
    parse_metrics_window,
)
from app.runtime.read_service import StreamNotFoundError
from app.runtime.schemas import (
    RecentRouteErrorItem,
    RouteRuntimeLatencyTrendPoint,
    RouteRuntimeMetricsRow,
    RouteRuntimeSuccessRateTrendPoint,
    StreamMetricsCheckpoint,
    StreamMetricsCheckpointHistoryItem,
    StreamMetricsRecentRun,
    StreamMetricsRouteHealthRow,
    StreamMetricsStreamBlock,
    StreamMetricsTimeBucket,
    StreamRuntimeKpis,
    StreamRuntimeMetricsResponse,
    LatencyTimePoint,
    ThroughputTimePoint,
)
from app.streams.models import Stream

UTC = timezone.utc

_SUCCESS_STAGES = frozenset({"route_send_success", "route_retry_success"})
_FAILURE_STAGES = frozenset({"route_send_failed", "route_retry_failed", "route_unknown_failure_policy"})
_RETRY_OUTCOME_STAGES = frozenset({"route_retry_success", "route_retry_failed"})
_LATENCY_STAGES = _SUCCESS_STAGES | _FAILURE_STAGES
_ROUTE_SEND_SUCCESS = "route_send_success"
_TREND_BUCKETS = 12


def _obs_row_payload(payload_raw: object) -> dict[str, Any]:
    return payload_raw if isinstance(payload_raw, dict) else {}


def _payload_int(ps: dict[str, Any], key: str) -> int:
    v = ps.get(key)
    if isinstance(v, bool):
        return 0
    if isinstance(v, int):
        return max(0, v)
    if isinstance(v, float) and v.is_integer():
        return max(0, int(v))
    try:
        if v is not None:
            return max(0, int(v))
    except (TypeError, ValueError):
        pass
    return 0


def _input_events_run_complete(ps: dict[str, Any]) -> int:
    return _payload_int(ps, "input_events")


def _event_count_delivery(ps: dict[str, Any]) -> int:
    ec = _payload_int(ps, "event_count")
    return ec if ec > 0 else 1


def _checkpoint_preview(value: dict[str, Any]) -> str:
    try:
        s = json.dumps(value, default=str, separators=(",", ":"))
    except (TypeError, ValueError):
        s = str(value)
    if len(s) > 160:
        return f"{s[:157]}…"
    return s


def _max_dt(current: datetime | None, candidate: datetime | None) -> datetime | None:
    if candidate is None:
        return current
    if current is None or candidate > current:
        return candidate
    return current


def _p95_int(values: list[int]) -> float:
    """Nearest-rank P95 for non-empty integer samples (used by tests and trend helpers)."""
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    if n == 1:
        return float(s[0])
    k = max(0, min(n - 1, math.ceil(0.95 * n) - 1))
    return float(s[k])


def _route_connectivity_state(
    *,
    route_enabled: bool,
    destination_enabled: bool,
    route_status: str,
    delivered_ev: int,
    failed_ev: int,
) -> Literal["HEALTHY", "DEGRADED", "ERROR", "DISABLED"]:
    rs = str(route_status or "").strip().upper()
    if not route_enabled or not destination_enabled or rs != "ENABLED":
        return "DISABLED"
    if failed_ev <= 0:
        return "HEALTHY"
    if delivered_ev <= 0:
        return "ERROR"
    return "DEGRADED"


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _max_created_filter(
    db: Session,
    stream_id: int,
    stages: frozenset[str],
    *,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
) -> datetime | None:
    q = db.query(func.max(DeliveryLog.created_at)).filter(
        DeliveryLog.stream_id == stream_id,
        DeliveryLog.stage.in_(set(stages)),
    )
    if start_at is not None:
        q = q.filter(DeliveryLog.created_at >= start_at)
    if end_at is not None:
        q = q.filter(DeliveryLog.created_at < end_at)
    return q.scalar()


def build_stream_runtime_metrics(
    db: Session,
    stream_id: int,
    *,
    window: str = "1h",
) -> StreamRuntimeMetricsResponse:
    """Build metrics from aggregated delivery_logs + checkpoints (bounded windows)."""

    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if stream is None:
        raise StreamNotFoundError(stream_id)

    checkpoint_row = db.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).first()
    last_cp: StreamMetricsCheckpoint | None = None
    checkpoint_history: list[StreamMetricsCheckpointHistoryItem] = []
    if checkpoint_row is not None:
        val = dict(checkpoint_row.checkpoint_value_json or {})
        last_cp = StreamMetricsCheckpoint(type=str(checkpoint_row.checkpoint_type), value=val)
        checkpoint_history.append(
            StreamMetricsCheckpointHistoryItem(
                updated_at=checkpoint_row.updated_at,
                checkpoint_preview=_checkpoint_preview(val),
            )
        )

    routes = (
        db.query(Route)
        .options(joinedload(Route.destination))
        .filter(Route.stream_id == stream_id)
        .order_by(Route.id.asc())
        .all()
    )

    td = parse_metrics_window(window)
    window_seconds = max(1, int(td.total_seconds()))
    now = _utc_now()
    since = now - td
    range_end = now

    bucket_sec = bucket_seconds_for_window(td)
    sparse_buckets = aggregate_stream_delivery_buckets(
        db,
        stream_id=stream_id,
        start_at=since,
        end_at=range_end,
        bucket_seconds=bucket_sec,
    )
    mb = max_buckets_for_window(td, bucket_sec)
    stream_buckets = dense_stream_delivery_buckets(
        sparse_buckets,
        start_at=since,
        end_at=range_end,
        bucket_seconds=bucket_sec,
        max_buckets=mb,
    )

    events_over_time: list[StreamMetricsTimeBucket] = []
    throughput_over_time: list[ThroughputTimePoint] = []
    latency_over_time: list[LatencyTimePoint] = []
    for b in stream_buckets:
        ts = b.bucket_start
        eps = float(b.delivered) / float(bucket_sec) if bucket_sec > 0 else 0.0
        events_over_time.append(
            StreamMetricsTimeBucket(
                timestamp=ts,
                events=int(b.events),
                delivered=int(b.delivered),
                failed=int(b.failed),
            )
        )
        throughput_over_time.append(ThroughputTimePoint(timestamp=ts, events_per_sec=round(eps, 6)))
        latency_over_time.append(LatencyTimePoint(timestamp=ts, avg_latency_ms=round(float(b.avg_latency_ms), 3)))

    events_in_window = sum(int(x.events) for x in stream_buckets)
    delivered_in_window = sum(int(x.delivered) for x in stream_buckets)
    failed_rows_in_window = sum(int(x.failed) for x in stream_buckets)

    succ_attempts = int(
        db.query(func.count(DeliveryLog.id))
        .filter(
            DeliveryLog.stream_id == stream_id,
            DeliveryLog.created_at >= since,
            DeliveryLog.created_at < range_end,
            DeliveryLog.stage.in_(_SUCCESS_STAGES),
        )
        .scalar()
        or 0
    )
    fail_attempts = int(
        db.query(func.count(DeliveryLog.id))
        .filter(
            DeliveryLog.stream_id == stream_id,
            DeliveryLog.created_at >= since,
            DeliveryLog.created_at < range_end,
            DeliveryLog.stage.in_(_FAILURE_STAGES),
        )
        .scalar()
        or 0
    )
    attempts = succ_attempts + fail_attempts
    if attempts > 0:
        delivery_success_rate = round(100.0 * succ_attempts / attempts, 1)
        error_rate = round(100.0 * fail_attempts / attempts, 1)
    else:
        delivery_success_rate = 100.0
        error_rate = 0.0

    lat_avg_row = (
        db.query(func.avg(DeliveryLog.latency_ms))
        .filter(
            DeliveryLog.stream_id == stream_id,
            DeliveryLog.created_at >= since,
            DeliveryLog.created_at < range_end,
            DeliveryLog.stage.in_(_LATENCY_STAGES),
            DeliveryLog.latency_ms.isnot(None),
            DeliveryLog.latency_ms >= 0,
        )
        .scalar()
    )
    lat_max_row = (
        db.query(func.max(DeliveryLog.latency_ms))
        .filter(
            DeliveryLog.stream_id == stream_id,
            DeliveryLog.created_at >= since,
            DeliveryLog.created_at < range_end,
            DeliveryLog.stage.in_(_LATENCY_STAGES),
            DeliveryLog.latency_ms.isnot(None),
            DeliveryLog.latency_ms >= 0,
        )
        .scalar()
    )
    avg_latency_ms = round(float(lat_avg_row or 0.0), 1)
    max_latency_ms = float(lat_max_row or 0.0)

    kpis = StreamRuntimeKpis(
        events_last_hour=int(events_in_window),
        delivered_last_hour=int(delivered_in_window),
        failed_last_hour=int(failed_rows_in_window),
        delivery_success_rate=float(delivery_success_rate),
        avg_latency_ms=float(avg_latency_ms),
        max_latency_ms=float(max_latency_ms),
        error_rate=float(error_rate),
    )

    last_run_at = _max_created_filter(db, stream_id, frozenset({"run_complete"}))
    last_success_at = _max_created_filter(db, stream_id, _SUCCESS_STAGES)
    last_error_at = _max_created_filter(db, stream_id, _FAILURE_STAGES)

    route_agg = {r.route_id: r for r in aggregate_route_window_stats(db, stream_id=stream_id, start_at=since, end_at=range_end)}
    fail_msgs = latest_failure_messages_for_stream(db, stream_id=stream_id, start_at=since, end_at=range_end)

    trend_bucket_sec = max(60, window_seconds // _TREND_BUCKETS)
    trend_rows = aggregate_route_trend_buckets(
        db,
        stream_id=stream_id,
        start_at=since,
        end_at=range_end,
        bucket_seconds=trend_bucket_sec,
    )
    mb_trend = min(_TREND_BUCKETS, max_buckets_for_window(td, trend_bucket_sec))

    route_health_rows: list[StreamMetricsRouteHealthRow] = []
    route_runtime_rows: list[RouteRuntimeMetricsRow] = []

    for route in routes:
        rid = int(route.id)
        dest = route.destination
        dest_name = str(dest.name).strip() if dest is not None and dest.name else f"Destination #{route.destination_id}"
        dest_type = str(dest.destination_type or "").strip().upper() if dest is not None else ""
        dest_enabled = bool(dest.enabled) if dest is not None else False

        rw = route_agg.get(rid)
        succ_c = int(rw.success_attempts) if rw else 0
        fail_c = int(rw.failure_attempts) if rw else 0
        delivered_ev = int(rw.delivered_events) if rw else 0
        failed_ev = int(rw.failed_events) if rw else 0
        events_total = delivered_ev + failed_ev
        if events_total > 0:
            success_rate = round(100.0 * delivered_ev / events_total, 1)
        else:
            success_rate = 100.0

        lsucc = rw.last_success_at if rw else None
        lfail = rw.last_failure_at if rw else None
        r_avg_lat = round(float(rw.avg_latency_ms), 1) if rw else 0.0
        r_max_lat = float(rw.max_latency_ms) if rw else 0.0
        r_p95_lat = float(r_max_lat)

        retry_count_1h = int(rw.retry_events) if rw else 0
        eps_current = round(delivered_ev / float(window_seconds), 6) if window_seconds > 0 else 0.0

        tr_list = dense_route_trend_series(
            trend_rows,
            route_id=rid,
            start_at=since,
            end_at=range_end,
            bucket_seconds=trend_bucket_sec,
            max_buckets=mb_trend,
        )
        latency_trend: list[RouteRuntimeLatencyTrendPoint] = []
        success_rate_trend: list[RouteRuntimeSuccessRateTrendPoint] = []
        for tr in tr_list:
            latency_trend.append(
                RouteRuntimeLatencyTrendPoint(timestamp=tr.bucket_start, avg_latency_ms=round(tr.avg_latency_ms, 1))
            )
            tot_b = tr.delivered_events + tr.failed_events
            sr_b = 100.0 if tot_b <= 0 else round(100.0 * tr.delivered_events / tot_b, 1)
            success_rate_trend.append(RouteRuntimeSuccessRateTrendPoint(timestamp=tr.bucket_start, success_rate=sr_b))

        connectivity = _route_connectivity_state(
            route_enabled=bool(route.enabled),
            destination_enabled=dest_enabled,
            route_status=str(route.status),
            delivered_ev=delivered_ev,
            failed_ev=failed_ev,
        )

        dr = route.disable_reason
        disable_reason_val = str(dr).strip() if dr else None

        msg_t = fail_msgs.get(rid)
        last_err_msg = msg_t[0] if msg_t else None
        last_err_code = msg_t[1] if msg_t else None

        route_runtime_rows.append(
            RouteRuntimeMetricsRow(
                route_id=rid,
                destination_id=int(route.destination_id),
                destination_name=dest_name,
                destination_type=dest_type,
                enabled=bool(route.enabled),
                route_status=str(route.status),
                success_rate=float(success_rate),
                events_last_hour=int(events_total),
                delivered_last_hour=int(delivered_ev),
                failed_last_hour=int(failed_ev),
                avg_latency_ms=float(r_avg_lat),
                p95_latency_ms=float(r_p95_lat),
                max_latency_ms=float(r_max_lat),
                eps_current=float(eps_current),
                retry_count_last_hour=int(retry_count_1h),
                last_success_at=lsucc,
                last_failure_at=lfail,
                last_error_message=last_err_msg,
                last_error_code=last_err_code,
                failure_policy=str(route.failure_policy),
                connectivity_state=connectivity,
                disable_reason=disable_reason_val,
                latency_trend=latency_trend,
                success_rate_trend=success_rate_trend,
            )
        )

        route_health_rows.append(
            StreamMetricsRouteHealthRow(
                route_id=rid,
                destination_name=dest_name,
                destination_type=dest_type,
                enabled=bool(route.enabled),
                success_count=int(succ_c),
                failed_count=int(fail_c),
                last_success_at=lsucc,
                last_failure_at=lfail,
                avg_latency_ms=float(r_avg_lat),
                failure_policy=str(route.failure_policy),
                last_error_message=last_err_msg,
            )
        )

    recent_route_errors: list[RecentRouteErrorItem] = []
    route_dest_names: dict[int, str] = {}
    for r in routes:
        rd = r.destination
        route_dest_names[int(r.id)] = (
            str(rd.name).strip() if rd is not None and rd.name else f"Destination #{r.destination_id}"
        )
    fail_rows = (
        db.query(DeliveryLog)
        .filter(
            DeliveryLog.stream_id == stream_id,
            DeliveryLog.created_at >= since,
            DeliveryLog.created_at < range_end,
            DeliveryLog.stage.in_(_FAILURE_STAGES),
        )
        .order_by(DeliveryLog.created_at.desc())
        .limit(40)
        .all()
    )
    for row in fail_rows:
        if row.route_id is None:
            continue
        rid = int(row.route_id)
        recent_route_errors.append(
            RecentRouteErrorItem(
                created_at=row.created_at,
                route_id=rid,
                destination_id=int(row.destination_id) if row.destination_id is not None else None,
                destination_name=route_dest_names.get(rid, f"Destination #{row.destination_id or '?'}"),
                error_code=str(row.error_code) if row.error_code else None,
                message=str(row.message),
            )
        )

    recent_runs: list[StreamMetricsRecentRun] = []
    completes = (
        db.query(DeliveryLog)
        .filter(
            DeliveryLog.stream_id == stream_id,
            DeliveryLog.stage == "run_complete",
            DeliveryLog.created_at >= since,
            DeliveryLog.created_at < range_end,
        )
        .order_by(DeliveryLog.created_at.desc())
        .limit(25)
        .all()
    )
    for row in completes:
        ps = _obs_row_payload(row.payload_sample)
        inp = _input_events_run_complete(ps)
        succ = _payload_int(ps, "success_events")
        if succ <= 0:
            succ = _payload_int(ps, "delivered_event_count")
        failed = max(0, inp - succ) if inp > 0 else 0
        run_status: Literal["SUCCESS", "PARTIAL", "FAILED", "NO_EVENTS"]
        if inp <= 0:
            run_status = "NO_EVENTS"
        elif succ >= inp:
            run_status = "SUCCESS"
        elif succ > 0:
            run_status = "PARTIAL"
        else:
            run_status = "FAILED"

        recent_runs.append(
            StreamMetricsRecentRun(
                run_id=f"run-{row.id}",
                started_at=row.created_at,
                duration_ms=0,
                status=run_status,
                events=int(inp),
                delivered=int(succ),
                failed=int(failed),
            )
        )

    stream_block = StreamMetricsStreamBlock(
        id=int(stream.id),
        name=str(stream.name),
        status=str(stream.status),
        last_run_at=last_run_at,
        last_success_at=last_success_at,
        last_error_at=last_error_at,
        last_checkpoint=last_cp,
    )

    return StreamRuntimeMetricsResponse(
        stream=stream_block,
        kpis=kpis,
        metrics_window_seconds=int(window_seconds),
        events_over_time=events_over_time,
        throughput_over_time=throughput_over_time,
        latency_over_time=latency_over_time,
        route_health=route_health_rows,
        checkpoint_history=checkpoint_history,
        recent_runs=recent_runs,
        route_runtime=route_runtime_rows,
        recent_route_errors=recent_route_errors,
    )


def build_degraded_stream_runtime_metrics(db: Session, stream_id: int, *, window: str = "1h") -> StreamRuntimeMetricsResponse:
    """Minimal metrics payload when aggregation fails (per-stream errors must not 500 list views)."""

    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if stream is None:
        raise StreamNotFoundError(stream_id)
    td = parse_metrics_window(window)
    window_seconds = max(1, int(td.total_seconds()))
    kpis = StreamRuntimeKpis()
    stream_block = StreamMetricsStreamBlock(
        id=int(stream.id),
        name=str(stream.name),
        status=str(stream.status),
    )
    return StreamRuntimeMetricsResponse(
        stream=stream_block,
        kpis=kpis,
        metrics_window_seconds=int(window_seconds),
        events_over_time=[],
        route_health=[],
        checkpoint_history=[],
        recent_runs=[],
        route_runtime=[],
        recent_route_errors=[],
    )
