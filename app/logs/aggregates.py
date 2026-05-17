"""PostgreSQL aggregation helpers for delivery_logs time-series (bounded windows)."""

from __future__ import annotations

import math
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.logs import incremental_aggregates as incremental

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class StreamBucketRow:
    bucket_start: datetime
    events: int
    delivered: int
    failed: int
    avg_latency_ms: float


def aggregate_stream_delivery_buckets(
    db: Session,
    *,
    stream_id: int,
    start_at: datetime,
    end_at: datetime,
    bucket_seconds: int,
) -> list[StreamBucketRow]:
    """Bucket aggregates for one stream within [start_at, end_at). Omits DEBUG rows."""

    if bucket_seconds <= 0:
        bucket_seconds = 60

    try:
        facts = incremental.delivery_log_aggregate_facts(
            db,
            start_at=start_at,
            end_at=end_at,
            stream_id=stream_id,
        )
        bucketed: dict[float, dict[str, float | int]] = {}
        for fact in facts:
            epoch = incremental.bucket_epoch(fact.created_at, bucket_seconds)
            row = bucketed.setdefault(
                epoch,
                {"events": 0, "delivered": 0, "failed": 0, "latency_sum": 0.0, "latency_count": 0},
            )
            if fact.stage == "run_complete":
                row["events"] = int(row["events"]) + fact.input_events
            elif fact.stage in incremental.SUCCESS_STAGES:
                row["delivered"] = int(row["delivered"]) + fact.event_count
            elif fact.stage in incremental.FAILURE_STAGES:
                row["failed"] = int(row["failed"]) + fact.event_count
            if fact.stage == "route_send_success" and fact.latency_ms is not None and fact.latency_ms >= 0:
                row["latency_sum"] = float(row["latency_sum"]) + float(fact.latency_ms)
                row["latency_count"] = int(row["latency_count"]) + 1
        return [
            StreamBucketRow(
                bucket_start=datetime.fromtimestamp(epoch, tz=UTC),
                events=int(row["events"]),
                delivered=int(row["delivered"]),
                failed=int(row["failed"]),
                avg_latency_ms=(
                    float(row["latency_sum"]) / int(row["latency_count"])
                    if int(row["latency_count"]) > 0
                    else 0.0
                ),
            )
            for epoch, row in sorted(bucketed.items())
        ]
    except Exception:
        logger.exception("incremental_stream_delivery_buckets_failed")

    sql = text(
        """
        SELECT
            to_timestamp(
                floor(extract(epoch from delivery_logs.created_at) / :bucket) * :bucket
            ) AS bucket_start,
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage = 'run_complete' THEN GREATEST(
                            0,
                            COALESCE((delivery_logs.payload_sample->>'input_events')::bigint, 0)
                        )
                        ELSE 0
                    END
                ),
                0
            )::bigint AS events,
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage IN ('route_send_success', 'route_retry_success') THEN GREATEST(
                            1,
                            COALESCE((delivery_logs.payload_sample->>'event_count')::bigint, 1)
                        )
                        ELSE 0
                    END
                ),
                0
            )::bigint AS delivered,
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage IN (
                            'route_send_failed',
                            'route_retry_failed',
                            'route_unknown_failure_policy'
                        ) THEN GREATEST(
                            1,
                            COALESCE((delivery_logs.payload_sample->>'event_count')::bigint, 1)
                        )
                        ELSE 0
                    END
                ),
                0
            )::bigint AS failed,
            COALESCE(
                AVG(
                    CASE
                        WHEN delivery_logs.stage = 'route_send_success'
                            AND delivery_logs.latency_ms IS NOT NULL
                            AND delivery_logs.latency_ms >= 0
                        THEN delivery_logs.latency_ms::double precision
                        ELSE NULL
                    END
                ),
                0.0
            ) AS avg_latency_ms
        FROM delivery_logs
        WHERE delivery_logs.stream_id = :stream_id
          AND delivery_logs.created_at >= :start_at
          AND delivery_logs.created_at < :end_at
          AND UPPER(COALESCE(delivery_logs.level, '')) <> 'DEBUG'
        GROUP BY 1
        ORDER BY 1 ASC
        """
    )

    rows = db.execute(
        sql,
        {
            "stream_id": stream_id,
            "start_at": start_at,
            "end_at": end_at,
            "bucket": int(bucket_seconds),
        },
    ).fetchall()

    out: list[StreamBucketRow] = []
    for r in rows:
        bs = r[0]
        if bs is None:
            continue
        out.append(
            StreamBucketRow(
                bucket_start=bs if isinstance(bs, datetime) else datetime.fromisoformat(str(bs)),
                events=int(r[1] or 0),
                delivered=int(r[2] or 0),
                failed=int(r[3] or 0),
                avg_latency_ms=float(r[4] or 0.0),
            )
        )
    return out


UTC = timezone.utc


def dense_stream_delivery_buckets(
    sparse: list[StreamBucketRow],
    *,
    start_at: datetime,
    end_at: datetime,
    bucket_seconds: int,
    max_buckets: int,
) -> list[StreamBucketRow]:
    """Emit one row per bucket between start_at and end_at (aligned like SQL), filling zeros."""

    bs = max(1, int(bucket_seconds))
    mb = max(1, min(int(max_buckets), 256))
    start_epoch = start_at.timestamp()
    end_epoch = end_at.timestamp()
    first = math.floor(start_epoch / bs) * bs

    by_epoch: dict[float, StreamBucketRow] = {}
    for row in sparse:
        raw_ts = row.bucket_start
        ep = raw_ts.timestamp() if getattr(raw_ts, "tzinfo", None) else raw_ts.replace(tzinfo=UTC).timestamp()
        key = math.floor(ep / bs) * bs
        by_epoch[key] = row

    out: list[StreamBucketRow] = []
    t = first
    while t < end_epoch and len(out) < mb:
        r = by_epoch.get(t)
        if r is None:
            out.append(
                StreamBucketRow(
                    bucket_start=datetime.fromtimestamp(t, tz=UTC),
                    events=0,
                    delivered=0,
                    failed=0,
                    avg_latency_ms=0.0,
                )
            )
        else:
            out.append(r)
        t += bs
    return out


@dataclass(frozen=True)
class PlatformOutcomeBucketRow:
    """Per-bucket delivery outcome counts (all streams) for dashboard time-series."""

    bucket_start: datetime
    success: int
    failed: int
    rate_limited: int


@dataclass(frozen=True)
class DeliveryOutcomeTotals:
    """Destination delivery outcome event totals from route delivery stages."""

    success_events: int
    failure_events: int


@dataclass(frozen=True)
class DeliveryOutcomeByDestinationRow:
    destination_id: int
    success_events: int
    failure_events: int


def aggregate_delivery_outcome_totals(
    db: Session,
    *,
    start_at: datetime,
    end_at: datetime,
    stream_id: int | None = None,
    route_id: int | None = None,
    destination_id: int | None = None,
) -> DeliveryOutcomeTotals:
    """Shared DELIVERY_OUTCOMES source: event_count sums on route delivery stages."""

    try:
        success, failure = incremental.delivery_outcome_totals(
            db,
            start_at=start_at,
            end_at=end_at,
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
        )
        return DeliveryOutcomeTotals(success_events=success, failure_events=failure)
    except Exception:
        logger.exception("incremental_delivery_outcome_totals_failed")

    sql = text(
        """
        SELECT
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage IN ('route_send_success', 'route_retry_success') THEN GREATEST(
                            1,
                            COALESCE((delivery_logs.payload_sample->>'event_count')::bigint, 1)
                        )
                        ELSE 0
                    END
                ),
                0
            )::bigint AS success_events,
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage IN (
                            'route_send_failed',
                            'route_retry_failed',
                            'route_unknown_failure_policy'
                        ) THEN GREATEST(
                            1,
                            COALESCE((delivery_logs.payload_sample->>'event_count')::bigint, 1)
                        )
                        ELSE 0
                    END
                ),
                0
            )::bigint AS failure_events
        FROM delivery_logs
        WHERE delivery_logs.created_at >= :start_at
          AND delivery_logs.created_at < :end_at
          AND UPPER(COALESCE(delivery_logs.level, '')) <> 'DEBUG'
          AND (:stream_id IS NULL OR delivery_logs.stream_id = :stream_id)
          AND (:route_id IS NULL OR delivery_logs.route_id = :route_id)
          AND (:destination_id IS NULL OR delivery_logs.destination_id = :destination_id)
        """
    )
    row = db.execute(
        sql,
        {
            "start_at": start_at,
            "end_at": end_at,
            "stream_id": stream_id,
            "route_id": route_id,
            "destination_id": destination_id,
        },
    ).one()
    return DeliveryOutcomeTotals(success_events=int(row[0] or 0), failure_events=int(row[1] or 0))


def aggregate_delivery_outcomes_by_destination(
    db: Session,
    *,
    start_at: datetime,
    end_at: datetime,
) -> list[DeliveryOutcomeByDestinationRow]:
    """Shared DELIVERY_OUTCOMES destination distribution for UI charts."""

    try:
        facts = incremental.delivery_log_aggregate_facts(db, start_at=start_at, end_at=end_at)
        by_destination: dict[int, list[int]] = {}
        for fact in facts:
            if fact.destination_id is None:
                continue
            row = by_destination.setdefault(fact.destination_id, [0, 0])
            if fact.stage in incremental.SUCCESS_STAGES:
                row[0] += fact.event_count
            elif fact.stage in incremental.FAILURE_STAGES:
                row[1] += fact.event_count
        return [
            DeliveryOutcomeByDestinationRow(
                destination_id=destination_id,
                success_events=counts[0],
                failure_events=counts[1],
            )
            for destination_id, counts in sorted(
                by_destination.items(),
                key=lambda item: (-item[1][0], -item[1][1], item[0]),
            )
        ]
    except Exception:
        logger.exception("incremental_delivery_outcomes_by_destination_failed")

    sql = text(
        """
        SELECT
            delivery_logs.destination_id AS destination_id,
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage IN ('route_send_success', 'route_retry_success') THEN GREATEST(
                            1,
                            COALESCE((delivery_logs.payload_sample->>'event_count')::bigint, 1)
                        )
                        ELSE 0
                    END
                ),
                0
            )::bigint AS success_events,
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage IN (
                            'route_send_failed',
                            'route_retry_failed',
                            'route_unknown_failure_policy'
                        ) THEN GREATEST(
                            1,
                            COALESCE((delivery_logs.payload_sample->>'event_count')::bigint, 1)
                        )
                        ELSE 0
                    END
                ),
                0
            )::bigint AS failure_events
        FROM delivery_logs
        WHERE delivery_logs.created_at >= :start_at
          AND delivery_logs.created_at < :end_at
          AND delivery_logs.destination_id IS NOT NULL
          AND UPPER(COALESCE(delivery_logs.level, '')) <> 'DEBUG'
        GROUP BY delivery_logs.destination_id
        ORDER BY success_events DESC, failure_events DESC, delivery_logs.destination_id ASC
        """
    )
    rows = db.execute(sql, {"start_at": start_at, "end_at": end_at}).fetchall()
    return [
        DeliveryOutcomeByDestinationRow(
            destination_id=int(r[0]),
            success_events=int(r[1] or 0),
            failure_events=int(r[2] or 0),
        )
        for r in rows
        if r[0] is not None
    ]


def aggregate_platform_outcome_buckets(
    db: Session,
    *,
    start_at: datetime,
    end_at: datetime,
    bucket_seconds: int,
) -> list[PlatformOutcomeBucketRow]:
    """Stacked chart series: success (delivered events), failed route outcomes, rate-limited rows."""

    if bucket_seconds <= 0:
        bucket_seconds = 60

    try:
        facts = incremental.delivery_log_aggregate_facts(db, start_at=start_at, end_at=end_at)
        bucketed: dict[float, list[int]] = {}
        for fact in facts:
            row = bucketed.setdefault(incremental.bucket_epoch(fact.created_at, bucket_seconds), [0, 0, 0])
            if fact.stage in incremental.SUCCESS_STAGES:
                row[0] += fact.event_count
            elif fact.stage in incremental.FAILURE_STAGES:
                row[1] += fact.event_count
            elif fact.stage in incremental.RATE_LIMIT_STAGES:
                row[2] += 1
        return [
            PlatformOutcomeBucketRow(
                bucket_start=datetime.fromtimestamp(epoch, tz=UTC),
                success=counts[0],
                failed=counts[1],
                rate_limited=counts[2],
            )
            for epoch, counts in sorted(bucketed.items())
        ]
    except Exception:
        logger.exception("incremental_platform_outcome_buckets_failed")

    sql = text(
        """
        SELECT
            to_timestamp(
                floor(extract(epoch from delivery_logs.created_at) / :bucket) * :bucket
            ) AS bucket_start,
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage IN ('route_send_success', 'route_retry_success') THEN GREATEST(
                            1,
                            COALESCE((delivery_logs.payload_sample->>'event_count')::bigint, 1)
                        )
                        ELSE 0
                    END
                ),
                0
            )::bigint AS success,
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage IN (
                            'route_send_failed',
                            'route_retry_failed',
                            'route_unknown_failure_policy'
                        ) THEN GREATEST(
                            1,
                            COALESCE((delivery_logs.payload_sample->>'event_count')::bigint, 1)
                        )
                        ELSE 0
                    END
                ),
                0
            )::bigint AS failed,
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage IN ('source_rate_limited', 'destination_rate_limited') THEN 1
                        ELSE 0
                    END
                ),
                0
            )::bigint AS rate_limited
        FROM delivery_logs
        WHERE delivery_logs.created_at >= :start_at
          AND delivery_logs.created_at < :end_at
          AND UPPER(COALESCE(delivery_logs.level, '')) <> 'DEBUG'
        GROUP BY 1
        ORDER BY 1 ASC
        """
    )

    rows = db.execute(
        sql,
        {
            "start_at": start_at,
            "end_at": end_at,
            "bucket": int(bucket_seconds),
        },
    ).fetchall()

    out: list[PlatformOutcomeBucketRow] = []
    for r in rows:
        bs = r[0]
        if bs is None:
            continue
        bucket_dt = bs if isinstance(bs, datetime) else datetime.fromisoformat(str(bs))
        out.append(
            PlatformOutcomeBucketRow(
                bucket_start=bucket_dt,
                success=int(r[1] or 0),
                failed=int(r[2] or 0),
                rate_limited=int(r[3] or 0),
            )
        )
    return out


def aggregate_platform_window_event_totals(
    db: Session,
    *,
    start_at: datetime,
    end_at: datetime,
) -> tuple[int, int]:
    """Platform-wide event totals in [start_at, end_at) for dashboard KPIs.

    Returns ``(processed_events, delivery_outcome_events)`` where:
    - processed_events: sum of ``input_events`` on ``run_complete`` rows
    - delivery_outcome_events: sum of ``event_count`` on route success/failure stages
    """

    try:
        processed = incremental.processed_event_total(db, start_at=start_at, end_at=end_at)
        success, failure = incremental.delivery_outcome_totals(db, start_at=start_at, end_at=end_at)
        return processed, success + failure
    except Exception:
        logger.exception("incremental_platform_window_event_totals_failed")

    sql = text(
        """
        SELECT
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage = 'run_complete' THEN GREATEST(
                            0,
                            COALESCE((delivery_logs.payload_sample->>'input_events')::bigint, 0)
                        )
                        ELSE 0
                    END
                ),
                0
            )::bigint AS processed_events,
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage IN (
                            'route_send_success',
                            'route_retry_success',
                            'route_send_failed',
                            'route_retry_failed',
                            'route_unknown_failure_policy'
                        ) THEN GREATEST(
                            1,
                            COALESCE((delivery_logs.payload_sample->>'event_count')::bigint, 1)
                        )
                        ELSE 0
                    END
                ),
                0
            )::bigint AS delivery_outcome_events
        FROM delivery_logs
        WHERE delivery_logs.created_at >= :start_at
          AND delivery_logs.created_at < :end_at
          AND UPPER(COALESCE(delivery_logs.level, '')) <> 'DEBUG'
        """
    )
    row = db.execute(sql, {"start_at": start_at, "end_at": end_at}).one()
    return int(row[0] or 0), int(row[1] or 0)


def dense_platform_outcome_buckets(
    sparse: list[PlatformOutcomeBucketRow],
    *,
    start_at: datetime,
    end_at: datetime,
    bucket_seconds: int,
    max_buckets: int,
) -> list[PlatformOutcomeBucketRow]:
    """Emit one row per bucket between start_at and end_at, filling zeros (aligned like SQL)."""

    bs = max(1, int(bucket_seconds))
    mb = max(1, min(int(max_buckets), 256))
    start_epoch = start_at.timestamp()
    end_epoch = end_at.timestamp()
    first = math.floor(start_epoch / bs) * bs

    by_epoch: dict[float, PlatformOutcomeBucketRow] = {}
    for row in sparse:
        raw_ts = row.bucket_start
        ep = raw_ts.timestamp() if getattr(raw_ts, "tzinfo", None) else raw_ts.replace(tzinfo=UTC).timestamp()
        key = math.floor(ep / bs) * bs
        by_epoch[key] = row

    out: list[PlatformOutcomeBucketRow] = []
    t = first
    while t < end_epoch and len(out) < mb:
        r = by_epoch.get(t)
        if r is None:
            out.append(
                PlatformOutcomeBucketRow(
                    bucket_start=datetime.fromtimestamp(t, tz=UTC),
                    success=0,
                    failed=0,
                    rate_limited=0,
                )
            )
        else:
            out.append(r)
        t += bs
    return out


@dataclass(frozen=True)
class RouteWindowStatsRow:
    route_id: int
    success_attempts: int
    failure_attempts: int
    delivered_events: int
    failed_events: int
    retry_events: int
    avg_latency_ms: float
    max_latency_ms: int
    last_success_at: datetime | None
    last_failure_at: datetime | None


def aggregate_route_window_stats(
    db: Session,
    *,
    stream_id: int,
    start_at: datetime,
    end_at: datetime,
) -> list[RouteWindowStatsRow]:
    """Per-route aggregates for one stream in [start_at, end_at); skips DEBUG rows."""

    try:
        facts = incremental.delivery_log_aggregate_facts(
            db,
            start_at=start_at,
            end_at=end_at,
            stream_id=stream_id,
        )
        by_route: dict[int, dict[str, Any]] = {}
        for fact in facts:
            if fact.route_id is None:
                continue
            row = by_route.setdefault(
                fact.route_id,
                {
                    "route_id": fact.route_id,
                    "success_attempts": 0,
                    "failure_attempts": 0,
                    "delivered_events": 0,
                    "failed_events": 0,
                    "retry_events": 0,
                    "latency_sum": 0.0,
                    "latency_count": 0,
                    "max_latency_ms": 0,
                    "last_success_at": None,
                    "last_failure_at": None,
                },
            )
            if fact.stage in incremental.SUCCESS_STAGES:
                row["success_attempts"] += 1
                row["delivered_events"] += fact.event_count
                row["last_success_at"] = max(row["last_success_at"], fact.created_at) if row["last_success_at"] else fact.created_at
            elif fact.stage in incremental.FAILURE_STAGES:
                row["failure_attempts"] += 1
                row["failed_events"] += fact.event_count
                row["last_failure_at"] = max(row["last_failure_at"], fact.created_at) if row["last_failure_at"] else fact.created_at
            if fact.stage in incremental.RETRY_OUTCOME_STAGES:
                row["retry_events"] += 1
            if fact.stage == "route_send_success" and fact.latency_ms is not None and fact.latency_ms >= 0:
                row["latency_sum"] += float(fact.latency_ms)
                row["latency_count"] += 1
                row["max_latency_ms"] = max(int(row["max_latency_ms"]), int(fact.latency_ms))
        return [
            RouteWindowStatsRow(
                route_id=int(row["route_id"]),
                success_attempts=int(row["success_attempts"]),
                failure_attempts=int(row["failure_attempts"]),
                delivered_events=int(row["delivered_events"]),
                failed_events=int(row["failed_events"]),
                retry_events=int(row["retry_events"]),
                avg_latency_ms=(
                    float(row["latency_sum"]) / int(row["latency_count"])
                    if int(row["latency_count"]) > 0
                    else 0.0
                ),
                max_latency_ms=int(row["max_latency_ms"]),
                last_success_at=row["last_success_at"],
                last_failure_at=row["last_failure_at"],
            )
            for row in sorted(by_route.values(), key=lambda item: int(item["route_id"]))
        ]
    except Exception:
        logger.exception("incremental_route_window_stats_failed")

    sql = text(
        """
        SELECT
            delivery_logs.route_id AS route_id,
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage IN ('route_send_success', 'route_retry_success') THEN 1
                        ELSE 0
                    END
                ),
                0
            )::bigint AS success_attempts,
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage IN (
                            'route_send_failed',
                            'route_retry_failed',
                            'route_unknown_failure_policy'
                        ) THEN 1
                        ELSE 0
                    END
                ),
                0
            )::bigint AS failure_attempts,
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage IN ('route_send_success', 'route_retry_success') THEN GREATEST(
                            1,
                            COALESCE((delivery_logs.payload_sample->>'event_count')::bigint, 1)
                        )
                        ELSE 0
                    END
                ),
                0
            )::bigint AS delivered_events,
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage IN (
                            'route_send_failed',
                            'route_retry_failed',
                            'route_unknown_failure_policy'
                        ) THEN GREATEST(
                            1,
                            COALESCE((delivery_logs.payload_sample->>'event_count')::bigint, 1)
                        )
                        ELSE 0
                    END
                ),
                0
            )::bigint AS failed_events,
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage IN ('route_retry_success', 'route_retry_failed') THEN 1
                        ELSE 0
                    END
                ),
                0
            )::bigint AS retry_events,
            COALESCE(
                AVG(
                    CASE
                        WHEN delivery_logs.stage = 'route_send_success'
                            AND delivery_logs.latency_ms IS NOT NULL
                            AND delivery_logs.latency_ms >= 0
                        THEN delivery_logs.latency_ms::double precision
                        ELSE NULL
                    END
                ),
                0.0
            ) AS avg_latency_ms,
            COALESCE(
                MAX(
                    CASE
                        WHEN delivery_logs.stage = 'route_send_success'
                            AND delivery_logs.latency_ms IS NOT NULL
                            AND delivery_logs.latency_ms >= 0
                        THEN delivery_logs.latency_ms
                        ELSE NULL
                    END
                ),
                0
            )::bigint AS max_latency_ms,
            MAX(
                CASE
                    WHEN delivery_logs.stage IN ('route_send_success', 'route_retry_success')
                    THEN delivery_logs.created_at
                    ELSE NULL
                END
            ) AS last_success_at,
            MAX(
                CASE
                    WHEN delivery_logs.stage IN (
                        'route_send_failed',
                        'route_retry_failed',
                        'route_unknown_failure_policy'
                    )
                    THEN delivery_logs.created_at
                    ELSE NULL
                END
            ) AS last_failure_at
        FROM delivery_logs
        WHERE delivery_logs.stream_id = :stream_id
          AND delivery_logs.route_id IS NOT NULL
          AND delivery_logs.created_at >= :start_at
          AND delivery_logs.created_at < :end_at
          AND UPPER(COALESCE(delivery_logs.level, '')) <> 'DEBUG'
        GROUP BY delivery_logs.route_id
        """
    )

    rows = db.execute(
        sql,
        {"stream_id": stream_id, "start_at": start_at, "end_at": end_at},
    ).fetchall()

    out: list[RouteWindowStatsRow] = []
    for r in rows:
        rid = r[0]
        if rid is None:
            continue
        out.append(
            RouteWindowStatsRow(
                route_id=int(rid),
                success_attempts=int(r[1] or 0),
                failure_attempts=int(r[2] or 0),
                delivered_events=int(r[3] or 0),
                failed_events=int(r[4] or 0),
                retry_events=int(r[5] or 0),
                avg_latency_ms=float(r[6] or 0.0),
                max_latency_ms=int(r[7] or 0),
                last_success_at=r[8],
                last_failure_at=r[9],
            )
        )
    return out


@dataclass(frozen=True)
class RouteTrendBucketRow:
    route_id: int
    bucket_start: datetime
    avg_latency_ms: float
    delivered_events: int
    failed_events: int


def aggregate_route_trend_buckets(
    db: Session,
    *,
    stream_id: int,
    start_at: datetime,
    end_at: datetime,
    bucket_seconds: int,
) -> list[RouteTrendBucketRow]:
    """Per-route sub-window buckets for sparkline trends (bounded buckets)."""

    if bucket_seconds <= 0:
        bucket_seconds = 60

    try:
        facts = incremental.delivery_log_aggregate_facts(
            db,
            start_at=start_at,
            end_at=end_at,
            stream_id=stream_id,
        )
        bucketed: dict[tuple[int, float], dict[str, float | int]] = {}
        for fact in facts:
            if fact.route_id is None:
                continue
            key = (fact.route_id, incremental.bucket_epoch(fact.created_at, bucket_seconds))
            row = bucketed.setdefault(key, {"latency_sum": 0.0, "latency_count": 0, "delivered": 0, "failed": 0})
            if fact.stage == "route_send_success" and fact.latency_ms is not None and fact.latency_ms >= 0:
                row["latency_sum"] = float(row["latency_sum"]) + float(fact.latency_ms)
                row["latency_count"] = int(row["latency_count"]) + 1
            if fact.stage in incremental.SUCCESS_STAGES:
                row["delivered"] = int(row["delivered"]) + fact.event_count
            elif fact.stage in incremental.FAILURE_STAGES:
                row["failed"] = int(row["failed"]) + fact.event_count
        return [
            RouteTrendBucketRow(
                route_id=route_id,
                bucket_start=datetime.fromtimestamp(epoch, tz=UTC),
                avg_latency_ms=(
                    float(row["latency_sum"]) / int(row["latency_count"])
                    if int(row["latency_count"]) > 0
                    else 0.0
                ),
                delivered_events=int(row["delivered"]),
                failed_events=int(row["failed"]),
            )
            for (route_id, epoch), row in sorted(bucketed.items(), key=lambda item: (item[0][0], item[0][1]))
        ]
    except Exception:
        logger.exception("incremental_route_trend_buckets_failed")

    sql = text(
        """
        SELECT
            delivery_logs.route_id AS route_id,
            to_timestamp(
                floor(extract(epoch from delivery_logs.created_at) / :bucket) * :bucket
            ) AS bucket_start,
            COALESCE(
                AVG(
                    CASE
                        WHEN delivery_logs.stage = 'route_send_success'
                            AND delivery_logs.latency_ms IS NOT NULL
                            AND delivery_logs.latency_ms >= 0
                        THEN delivery_logs.latency_ms::double precision
                        ELSE NULL
                    END
                ),
                0.0
            ) AS avg_latency_ms,
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage IN ('route_send_success', 'route_retry_success') THEN GREATEST(
                            1,
                            COALESCE((delivery_logs.payload_sample->>'event_count')::bigint, 1)
                        )
                        ELSE 0
                    END
                ),
                0
            )::bigint AS delivered_events,
            COALESCE(
                SUM(
                    CASE
                        WHEN delivery_logs.stage IN (
                            'route_send_failed',
                            'route_retry_failed',
                            'route_unknown_failure_policy'
                        ) THEN GREATEST(
                            1,
                            COALESCE((delivery_logs.payload_sample->>'event_count')::bigint, 1)
                        )
                        ELSE 0
                    END
                ),
                0
            )::bigint AS failed_events
        FROM delivery_logs
        WHERE delivery_logs.stream_id = :stream_id
          AND delivery_logs.route_id IS NOT NULL
          AND delivery_logs.created_at >= :start_at
          AND delivery_logs.created_at < :end_at
          AND UPPER(COALESCE(delivery_logs.level, '')) <> 'DEBUG'
        GROUP BY
            delivery_logs.route_id,
            to_timestamp(floor(extract(epoch from delivery_logs.created_at) / :bucket) * :bucket)
        ORDER BY delivery_logs.route_id ASC, 2 ASC
        """
    )

    rows = db.execute(
        sql,
        {
            "stream_id": stream_id,
            "start_at": start_at,
            "end_at": end_at,
            "bucket": int(bucket_seconds),
        },
    ).fetchall()

    out: list[RouteTrendBucketRow] = []
    for r in rows:
        bs = r[1]
        if r[0] is None or bs is None:
            continue
        out.append(
            RouteTrendBucketRow(
                route_id=int(r[0]),
                bucket_start=bs if isinstance(bs, datetime) else datetime.fromisoformat(str(bs)),
                avg_latency_ms=float(r[2] or 0.0),
                delivered_events=int(r[3] or 0),
                failed_events=int(r[4] or 0),
            )
        )
    return out


def dense_route_trend_series(
    sparse: list[RouteTrendBucketRow],
    *,
    route_id: int,
    start_at: datetime,
    end_at: datetime,
    bucket_seconds: int,
    max_buckets: int,
) -> list[RouteTrendBucketRow]:
    """Fill missing per-route trend buckets (latency / success-rate sparklines)."""

    bs = max(1, int(bucket_seconds))
    mb = max(1, min(int(max_buckets), 256))
    start_epoch = start_at.timestamp()
    end_epoch = end_at.timestamp()
    first = math.floor(start_epoch / bs) * bs

    by_epoch: dict[float, RouteTrendBucketRow] = {}
    for row in sparse:
        if int(row.route_id) != int(route_id):
            continue
        raw_ts = row.bucket_start
        ep = raw_ts.timestamp() if getattr(raw_ts, "tzinfo", None) else raw_ts.replace(tzinfo=UTC).timestamp()
        key = math.floor(ep / bs) * bs
        by_epoch[key] = row

    out: list[RouteTrendBucketRow] = []
    t = first
    while t < end_epoch and len(out) < mb:
        r = by_epoch.get(t)
        if r is None:
            out.append(
                RouteTrendBucketRow(
                    route_id=int(route_id),
                    bucket_start=datetime.fromtimestamp(t, tz=UTC),
                    avg_latency_ms=0.0,
                    delivered_events=0,
                    failed_events=0,
                )
            )
        else:
            out.append(r)
        t += bs
    return out


@dataclass(frozen=True)
class AlertSummaryRow:
    stream_id: int
    stream_name: str
    connector_name: str
    severity: str
    count: int
    latest_occurrence: datetime


def latest_failure_messages_for_stream(
    db: Session,
    *,
    stream_id: int,
    start_at: datetime,
    end_at: datetime,
) -> dict[int, tuple[str, str | None]]:
    """Latest failure message + error_code per route_id within the window."""

    sql = text(
        """
        SELECT DISTINCT ON (delivery_logs.route_id)
            delivery_logs.route_id AS route_id,
            delivery_logs.message AS message,
            delivery_logs.error_code AS error_code
        FROM delivery_logs
        WHERE delivery_logs.stream_id = :stream_id
          AND delivery_logs.created_at >= :start_at
          AND delivery_logs.created_at < :end_at
          AND delivery_logs.route_id IS NOT NULL
          AND delivery_logs.stage IN (
              'route_send_failed',
              'route_retry_failed',
              'route_unknown_failure_policy'
          )
          AND UPPER(COALESCE(delivery_logs.level, '')) <> 'DEBUG'
        ORDER BY delivery_logs.route_id ASC, delivery_logs.created_at DESC
        """
    )

    rows = db.execute(
        sql,
        {"stream_id": stream_id, "start_at": start_at, "end_at": end_at},
    ).fetchall()

    out: dict[int, tuple[str, str | None]] = {}
    for r in rows:
        rid = r[0]
        if rid is None:
            continue
        msg = str(r[1] or "")
        ec = str(r[2]) if r[2] else None
        out[int(rid)] = (msg, ec)
    return out


def aggregate_warn_error_summaries(
    db: Session,
    *,
    start_at: datetime,
    end_at: datetime,
    limit: int,
) -> list[AlertSummaryRow]:
    """Grouped WARN/ERROR rows with stream + connector names (recent window)."""

    lim = max(1, min(int(limit), 500))
    sql = text(
        """
        SELECT
            streams.id AS stream_id,
            COALESCE(streams.name, '') AS stream_name,
            COALESCE(connectors.name, '') AS connector_name,
            UPPER(COALESCE(delivery_logs.level, '')) AS severity,
            COUNT(*)::bigint AS row_count,
            MAX(delivery_logs.created_at) AS latest_occurrence
        FROM delivery_logs
        INNER JOIN streams ON streams.id = delivery_logs.stream_id
        INNER JOIN sources ON sources.id = streams.source_id
        INNER JOIN connectors ON connectors.id = sources.connector_id
        WHERE delivery_logs.created_at >= :start_at
          AND delivery_logs.created_at < :end_at
          AND UPPER(COALESCE(delivery_logs.level, '')) IN ('WARN', 'ERROR', 'WARNING')
        GROUP BY streams.id, streams.name, connectors.name, UPPER(COALESCE(delivery_logs.level, ''))
        ORDER BY latest_occurrence DESC, row_count DESC
        LIMIT :lim
        """
    )

    rows = db.execute(
        sql,
        {"start_at": start_at, "end_at": end_at, "lim": lim},
    ).fetchall()

    out: list[AlertSummaryRow] = []
    for r in rows:
        sev = str(r[3] or "").strip().upper()
        if sev == "WARNING":
            sev = "WARN"
        out.append(
            AlertSummaryRow(
                stream_id=int(r[0]),
                stream_name=str(r[1] or ""),
                connector_name=str(r[2] or ""),
                severity=sev,
                count=int(r[4] or 0),
                latest_occurrence=r[5],
            )
        )
    return out
