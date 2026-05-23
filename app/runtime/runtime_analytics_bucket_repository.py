"""Incremental UPSERT and bounded reads for ``runtime_analytics_bucket_*`` tables."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.runtime.models import (
    RuntimeAnalyticsBucket1m,
    RuntimeAnalyticsBucket5m,
    RuntimeAnalyticsBucketUpdaterState,
)
from app.runtime.operational_snapshot_repository import (
    FAILURE_STAGES,
    OUTCOME_STAGES,
    RETRY_STAGES,
    SUCCESS_STAGES,
)

UTC = timezone.utc
BucketResolution = Literal["1m", "5m"]
BUCKET_SECONDS_1M = 60
BUCKET_SECONDS_5M = 300

_SUCCESS = tuple(SUCCESS_STAGES)
_FAILURE = tuple(FAILURE_STAGES)
_RETRY = tuple(RETRY_STAGES)
_OUTCOME = tuple(OUTCOME_STAGES)
_RATE_LIMIT = ("source_rate_limited", "destination_rate_limited")


@dataclass(frozen=True)
class AnalyticsBucketUpdateResult:
    rows_1m: int
    rows_5m: int
    logs_processed: int
    max_log_id: int | None


@dataclass(frozen=True)
class AnalyticsBucketRetentionResult:
    deleted_1m: int
    deleted_5m: int


def _table_for_resolution(resolution: BucketResolution):
    return RuntimeAnalyticsBucket1m if resolution == "1m" else RuntimeAnalyticsBucket5m


def bucket_seconds_for_resolution(resolution: BucketResolution) -> int:
    return BUCKET_SECONDS_1M if resolution == "1m" else BUCKET_SECONDS_5M


def analytics_buckets_populated(db: Session) -> bool:
    """True when at least one route-level bucket row exists."""

    return (db.query(func.count(RuntimeAnalyticsBucket1m.id)).scalar() or 0) > 0


def load_bucket_updater_state(db: Session) -> RuntimeAnalyticsBucketUpdaterState:
    state = db.get(RuntimeAnalyticsBucketUpdaterState, 1)
    if state is None:
        state = RuntimeAnalyticsBucketUpdaterState(id=1)
        db.add(state)
        db.flush()
    return state


def persist_bucket_updater_state(
    db: Session,
    *,
    last_delivery_log_id: int | None,
    last_scan_since: datetime,
) -> None:
    state = load_bucket_updater_state(db)
    if last_delivery_log_id is not None:
        current = state.last_delivery_log_id
        state.last_delivery_log_id = (
            max(int(current), int(last_delivery_log_id)) if current is not None else int(last_delivery_log_id)
        )
    state.last_scan_since = last_scan_since
    state.updated_at = datetime.now(UTC)
    db.add(state)


def _aggregate_batch_sql(*, bucket_seconds: int) -> str:
    return """
        WITH batch AS (
            SELECT
                delivery_logs.id,
                delivery_logs.created_at,
                delivery_logs.stream_id,
                delivery_logs.route_id,
                delivery_logs.destination_id,
                delivery_logs.stage,
                delivery_logs.latency_ms,
                delivery_logs.retry_count,
                GREATEST(
                    1,
                    COALESCE((delivery_logs.payload_sample->>'event_count')::bigint, 1)
                )::bigint AS event_count
            FROM delivery_logs
            WHERE delivery_logs.id > :last_id
            ORDER BY delivery_logs.id ASC
            LIMIT :batch_limit
        )
        SELECT
            timezone(
                'UTC',
                to_timestamp(
                    floor(extract(epoch FROM batch.created_at) / :bucket_seconds) * :bucket_seconds
                )
            ) AS bucket_start,
            batch.stream_id,
            batch.route_id,
            batch.destination_id,
            COALESCE(SUM(batch.event_count) FILTER (
                WHERE batch.stage = ANY(:outcome_stages)
            ), 0)::bigint AS event_count,
            COALESCE(SUM(batch.event_count) FILTER (
                WHERE batch.stage = ANY(:success_stages)
            ), 0)::bigint AS success_count,
            COALESCE(SUM(batch.event_count) FILTER (
                WHERE batch.stage = ANY(:failure_stages)
            ), 0)::bigint AS failure_count,
            COALESCE(SUM(
                CASE WHEN batch.stage = ANY(:retry_stages) THEN 1 ELSE 0 END
            ), 0)::bigint AS retry_count,
            COALESCE(SUM(
                CASE WHEN batch.stage = ANY(:rate_limit_stages) THEN 1 ELSE 0 END
            ), 0)::bigint AS rate_limited_count,
            AVG(batch.latency_ms::double precision) FILTER (
                WHERE batch.stage = ANY(:outcome_stages) AND batch.latency_ms IS NOT NULL
            ) AS latency_avg_ms,
            MAX(batch.latency_ms) FILTER (
                WHERE batch.stage = ANY(:outcome_stages) AND batch.latency_ms IS NOT NULL
            )::double precision AS latency_max_ms,
            COALESCE(SUM(
                CASE WHEN batch.stage = ANY(:failure_stages) THEN 1 ELSE 0 END
            ), 0)::bigint AS last_error_count
        FROM batch
        WHERE batch.route_id IS NOT NULL
          AND batch.stream_id IS NOT NULL
          AND batch.destination_id IS NOT NULL
        GROUP BY 1, 2, 3, 4
        """


def _fetch_batch_aggregates(
    db: Session,
    *,
    last_id: int,
    batch_limit: int,
    bucket_seconds: int,
) -> list[Any]:
    rows = db.execute(
        text(_aggregate_batch_sql(bucket_seconds=bucket_seconds)),
        {
            "last_id": int(last_id),
            "batch_limit": int(batch_limit),
            "bucket_seconds": int(bucket_seconds),
            "outcome_stages": list(_OUTCOME),
            "success_stages": list(_SUCCESS),
            "failure_stages": list(_FAILURE),
            "retry_stages": list(_RETRY),
            "rate_limit_stages": list(_RATE_LIMIT),
        },
    ).fetchall()
    return rows


def _max_log_id_in_batch(db: Session, *, last_id: int, batch_limit: int) -> int | None:
    row = db.execute(
        text(
            """
            SELECT MAX(id) AS max_id, COUNT(*) AS n
            FROM (
                SELECT id FROM delivery_logs
                WHERE delivery_logs.id > :last_id
                ORDER BY delivery_logs.id ASC
                LIMIT :batch_limit
            ) sub
            """
        ),
        {"last_id": int(last_id), "batch_limit": int(batch_limit)},
    ).one()
    if int(row[1] or 0) <= 0:
        return None
    return int(row[0]) if row[0] is not None else None


def _rows_to_payload(
    rows: list[Any],
    *,
    bucket_seconds: int,
    now: datetime,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for r in rows:
        bs = r[0]
        if bs is None:
            continue
        bucket_start = bs if isinstance(bs, datetime) else datetime.fromisoformat(str(bs))
        if bucket_start.tzinfo is None:
            bucket_start = bucket_start.replace(tzinfo=UTC)
        success = int(r[5] or 0)
        failure = int(r[6] or 0)
        events = int(r[4] or 0)
        eps = round((success + failure) / max(1, bucket_seconds), 6)
        lat_avg = float(r[9]) if r[9] is not None else None
        lat_max = float(r[10]) if r[10] is not None else None
        out.append(
            {
                "bucket_start": bucket_start,
                "stream_id": int(r[1]),
                "route_id": int(r[2]),
                "destination_id": int(r[3]),
                "event_count": events,
                "success_count": success,
                "failure_count": failure,
                "retry_count": int(r[7] or 0),
                "rate_limited_count": int(r[8] or 0),
                "eps_avg": eps,
                "latency_avg_ms": lat_avg,
                "latency_p95_ms": lat_max,
                "latency_max_ms": lat_max,
                "last_error_count": int(r[11] or 0),
                "health_transition_count": 0,
                "updated_at": now,
            }
        )
    return out


def _upsert_buckets(
    db: Session,
    model: type[RuntimeAnalyticsBucket1m] | type[RuntimeAnalyticsBucket5m],
    rows: list[dict[str, Any]],
) -> int:
    if not rows:
        return 0
    stmt = pg_insert(model).values(rows)
    excluded = stmt.excluded
    stmt = stmt.on_conflict_do_update(
        constraint=f"uq_{model.__tablename__}_bucket_dims",
        set_={
            "event_count": model.event_count + excluded.event_count,
            "success_count": model.success_count + excluded.success_count,
            "failure_count": model.failure_count + excluded.failure_count,
            "retry_count": model.retry_count + excluded.retry_count,
            "rate_limited_count": model.rate_limited_count + excluded.rate_limited_count,
            "eps_avg": excluded.eps_avg,
            "latency_avg_ms": excluded.latency_avg_ms,
            "latency_p95_ms": excluded.latency_p95_ms,
            "latency_max_ms": func.greatest(
                func.coalesce(model.latency_max_ms, 0),
                func.coalesce(excluded.latency_max_ms, 0),
            ),
            "last_error_count": model.last_error_count + excluded.last_error_count,
            "health_transition_count": model.health_transition_count + excluded.health_transition_count,
            "updated_at": excluded.updated_at,
        },
    )
    db.execute(stmt)
    return len(rows)


def recompute_and_upsert_analytics_buckets(
    db: Session,
    *,
    batch_limit: int = 50_000,
    bootstrap_minutes: int = 60,
) -> AnalyticsBucketUpdateResult:
    """Incrementally aggregate ``delivery_logs`` into 1m and 5m bucket tables."""

    now = datetime.now(UTC)
    state = load_bucket_updater_state(db)
    last_id = state.last_delivery_log_id
    if last_id is None:
        bootstrap_since = now - timedelta(minutes=max(5, bootstrap_minutes))
        row = db.execute(
            text(
                """
                SELECT COALESCE(MIN(id), 0) AS min_id
                FROM delivery_logs
                WHERE created_at >= :since
                """
            ),
            {"since": bootstrap_since},
        ).one()
        last_id = max(0, int(row[0] or 0) - 1)

    rows_1m_raw = _fetch_batch_aggregates(db, last_id=int(last_id), batch_limit=batch_limit, bucket_seconds=BUCKET_SECONDS_1M)
    rows_5m_raw = _fetch_batch_aggregates(db, last_id=int(last_id), batch_limit=batch_limit, bucket_seconds=BUCKET_SECONDS_5M)
    max_log_id = _max_log_id_in_batch(db, last_id=int(last_id), batch_limit=batch_limit)
    logs_processed = 0
    if max_log_id is not None:
        logs_processed = max(0, max_log_id - int(last_id))

    payload_1m = _rows_to_payload(rows_1m_raw, bucket_seconds=BUCKET_SECONDS_1M, now=now)
    payload_5m = _rows_to_payload(rows_5m_raw, bucket_seconds=BUCKET_SECONDS_5M, now=now)
    n1 = _upsert_buckets(db, RuntimeAnalyticsBucket1m, payload_1m)
    n5 = _upsert_buckets(db, RuntimeAnalyticsBucket5m, payload_5m)

    scan_since = now - timedelta(minutes=bootstrap_minutes)
    if max_log_id is not None:
        persist_bucket_updater_state(db, last_delivery_log_id=max_log_id, last_scan_since=scan_since)

    return AnalyticsBucketUpdateResult(
        rows_1m=n1,
        rows_5m=n5,
        logs_processed=logs_processed,
        max_log_id=max_log_id,
    )


def prune_analytics_buckets(
    db: Session,
    *,
    retention_1m_days: int,
    retention_5m_days: int,
    batch_size: int = 10_000,
) -> AnalyticsBucketRetentionResult:
    """Bounded delete of expired bucket rows (separate from delivery_logs retention)."""

    now = datetime.now(UTC)
    cutoff_1m = now - timedelta(days=max(1, retention_1m_days))
    cutoff_5m = now - timedelta(days=max(1, retention_5m_days))
    deleted_1m = db.execute(
        text(
            """
            DELETE FROM runtime_analytics_bucket_1m
            WHERE id IN (
                SELECT id FROM runtime_analytics_bucket_1m
                WHERE bucket_start < :cutoff
                ORDER BY bucket_start ASC
                LIMIT :batch
            )
            """
        ),
        {"cutoff": cutoff_1m, "batch": int(batch_size)},
    ).rowcount or 0
    deleted_5m = db.execute(
        text(
            """
            DELETE FROM runtime_analytics_bucket_5m
            WHERE id IN (
                SELECT id FROM runtime_analytics_bucket_5m
                WHERE bucket_start < :cutoff
                ORDER BY bucket_start ASC
                LIMIT :batch
            )
            """
        ),
        {"cutoff": cutoff_5m, "batch": int(batch_size)},
    ).rowcount or 0
    return AnalyticsBucketRetentionResult(deleted_1m=int(deleted_1m), deleted_5m=int(deleted_5m))


def select_resolution_for_window(window_seconds: int) -> BucketResolution:
    """24h and shorter windows use 1m buckets; longer windows use 5m buckets."""

    if window_seconds <= 24 * 3600:
        return "1m"
    return "5m"
