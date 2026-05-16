"""PostgreSQL aggregation helpers for delivery_logs time-series (bounded windows)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session


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
                        ) THEN 1
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
                        ) THEN 1
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
