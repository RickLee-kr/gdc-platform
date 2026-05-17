"""In-process incremental delivery log aggregate read model.

The cache is append-only by ``delivery_logs.id`` and never writes to runtime
tables.  Callers keep their existing SQL aggregate path as the fail-open source
of truth when refresh or read-model calculation is unavailable.
"""

from __future__ import annotations

import math
import threading
from dataclasses import dataclass
from datetime import datetime
from types import SimpleNamespace
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.logs.models import DeliveryLog

SUCCESS_STAGES = frozenset({"route_send_success", "route_retry_success"})
FAILURE_STAGES = frozenset({"route_send_failed", "route_retry_failed", "route_unknown_failure_policy"})
OUTCOME_STAGES = SUCCESS_STAGES | FAILURE_STAGES
RETRY_OUTCOME_STAGES = frozenset({"route_retry_success", "route_retry_failed"})
RATE_LIMIT_STAGES = frozenset({"source_rate_limited", "destination_rate_limited"})
LATENCY_STAGES = OUTCOME_STAGES


@dataclass(frozen=True)
class DeliveryLogAggregateFact:
    id: int
    created_at: datetime
    connector_id: int | None
    stream_id: int | None
    route_id: int | None
    destination_id: int | None
    stage: str
    level: str
    event_count: int
    input_events: int
    retry_count: int
    latency_ms: int | None
    error_code: str | None


@dataclass(frozen=True)
class LogRowTotals:
    total_rows: int
    success_rows: int
    failure_rows: int
    rate_limited_rows: int


def _payload_int(payload: Any, key: str, *, default: int = 0) -> int:
    data = payload if isinstance(payload, dict) else {}
    raw = data.get(key)
    if isinstance(raw, bool):
        return default
    if isinstance(raw, int):
        return raw
    if isinstance(raw, float) and raw.is_integer():
        return int(raw)
    try:
        if raw is not None:
            return int(raw)
    except (TypeError, ValueError):
        return default
    return default


def _event_count(payload: Any) -> int:
    return max(1, _payload_int(payload, "event_count", default=1))


def _input_events(payload: Any) -> int:
    return max(0, _payload_int(payload, "input_events", default=0))


def _fact_from_row(row: DeliveryLog) -> DeliveryLogAggregateFact:
    return DeliveryLogAggregateFact(
        id=int(row.id),
        created_at=row.created_at,
        connector_id=int(row.connector_id) if row.connector_id is not None else None,
        stream_id=int(row.stream_id) if row.stream_id is not None else None,
        route_id=int(row.route_id) if row.route_id is not None else None,
        destination_id=int(row.destination_id) if row.destination_id is not None else None,
        stage=str(row.stage),
        level=str(row.level or ""),
        event_count=_event_count(row.payload_sample),
        input_events=_input_events(row.payload_sample),
        retry_count=int(row.retry_count or 0),
        latency_ms=int(row.latency_ms) if row.latency_ms is not None else None,
        error_code=row.error_code,
    )


class DeliveryLogIncrementalAggregateCache:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._watermark_id = 0
        self._table_count = 0
        self._max_created_at: datetime | None = None
        self._facts_by_id: dict[int, DeliveryLogAggregateFact] = {}

    def clear(self) -> None:
        with self._lock:
            self._watermark_id = 0
            self._table_count = 0
            self._max_created_at = None
            self._facts_by_id.clear()

    def refresh(self, db: Session) -> None:
        table_count, max_id, max_created_at = db.query(
            func.count(DeliveryLog.id),
            func.coalesce(func.max(DeliveryLog.id), 0),
            func.max(DeliveryLog.created_at),
        ).one()
        table_count = int(table_count or 0)
        max_id = int(max_id or 0)
        marker_created_at: datetime | None = None
        with self._lock:
            marker_id = self._watermark_id
            marker_fact = self._facts_by_id.get(marker_id)
        if marker_id > 0 and marker_fact is not None and max_id >= marker_id:
            marker_created_at = (
                db.query(DeliveryLog.created_at)
                .filter(DeliveryLog.id == marker_id)
                .scalar()
            )
        with self._lock:
            if (
                max_id < self._watermark_id
                or table_count < len(self._facts_by_id)
                or (
                    marker_fact is not None
                    and (marker_created_at is None or marker_created_at != marker_fact.created_at)
                )
                or (
                    max_id <= self._watermark_id
                    and table_count != self._table_count
                )
                or (
                    max_id <= self._watermark_id
                    and max_created_at != self._max_created_at
                )
            ):
                self._watermark_id = 0
                self._table_count = 0
                self._max_created_at = None
                self._facts_by_id.clear()
            start_id = self._watermark_id
        if max_id <= start_id:
            return

        rows = (
            db.query(DeliveryLog)
            .filter(DeliveryLog.id > start_id, DeliveryLog.id <= max_id)
            .order_by(DeliveryLog.id.asc())
            .all()
        )
        facts = [_fact_from_row(row) for row in rows]
        with self._lock:
            if start_id != self._watermark_id and max_id >= self._watermark_id:
                # Another caller refreshed first; restart cheaply on the next request.
                return
            for fact in facts:
                self._facts_by_id[fact.id] = fact
            self._watermark_id = max_id
            self._table_count = table_count
            self._max_created_at = max_created_at

    def facts(
        self,
        db: Session,
        *,
        start_at: datetime,
        end_at: datetime,
        stream_id: int | None = None,
        route_id: int | None = None,
        destination_id: int | None = None,
        inclusive_end: bool = False,
        exclude_debug: bool = True,
    ) -> list[DeliveryLogAggregateFact]:
        self.refresh(db)
        with self._lock:
            facts = list(self._facts_by_id.values())

        out: list[DeliveryLogAggregateFact] = []
        for fact in facts:
            if fact.created_at < start_at:
                continue
            if inclusive_end:
                if fact.created_at > end_at:
                    continue
            elif fact.created_at >= end_at:
                continue
            if exclude_debug and fact.level.upper() == "DEBUG":
                continue
            if stream_id is not None and fact.stream_id != stream_id:
                continue
            if route_id is not None and fact.route_id != route_id:
                continue
            if destination_id is not None and fact.destination_id != destination_id:
                continue
            out.append(fact)
        return out


_CACHE = DeliveryLogIncrementalAggregateCache()


def clear_incremental_delivery_log_aggregate_cache() -> None:
    _CACHE.clear()


def delivery_log_aggregate_facts(
    db: Session,
    *,
    start_at: datetime,
    end_at: datetime,
    stream_id: int | None = None,
    route_id: int | None = None,
    destination_id: int | None = None,
    inclusive_end: bool = False,
    exclude_debug: bool = True,
) -> list[DeliveryLogAggregateFact]:
    return _CACHE.facts(
        db,
        start_at=start_at,
        end_at=end_at,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        inclusive_end=inclusive_end,
        exclude_debug=exclude_debug,
    )


def bucket_epoch(value: datetime, bucket_seconds: int) -> float:
    return math.floor(value.timestamp() / max(1, int(bucket_seconds))) * max(1, int(bucket_seconds))


def processed_event_total(
    db: Session,
    *,
    start_at: datetime,
    end_at: datetime,
    stream_id: int | None = None,
) -> int:
    facts = delivery_log_aggregate_facts(db, start_at=start_at, end_at=end_at, stream_id=stream_id)
    return sum(f.input_events for f in facts if f.stage == "run_complete")


def delivery_outcome_totals(
    db: Session,
    *,
    start_at: datetime,
    end_at: datetime,
    stream_id: int | None = None,
    route_id: int | None = None,
    destination_id: int | None = None,
) -> tuple[int, int]:
    success = failure = 0
    facts = delivery_log_aggregate_facts(
        db,
        start_at=start_at,
        end_at=end_at,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
    )
    for fact in facts:
        if fact.stage in SUCCESS_STAGES:
            success += fact.event_count
        elif fact.stage in FAILURE_STAGES:
            failure += fact.event_count
    return success, failure


def log_row_totals(
    db: Session,
    *,
    start_at: datetime,
    end_at: datetime,
    stream_id: int | None = None,
    route_id: int | None = None,
    destination_id: int | None = None,
) -> LogRowTotals:
    facts = delivery_log_aggregate_facts(
        db,
        start_at=start_at,
        end_at=end_at,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        exclude_debug=False,
    )
    return LogRowTotals(
        total_rows=len(facts),
        success_rows=sum(1 for f in facts if f.stage in SUCCESS_STAGES),
        failure_rows=sum(1 for f in facts if f.stage in FAILURE_STAGES),
        rate_limited_rows=sum(1 for f in facts if f.stage in RATE_LIMIT_STAGES),
    )


def route_outcome_rows(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
) -> list[SimpleNamespace]:
    facts = delivery_log_aggregate_facts(
        db,
        start_at=since,
        end_at=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        inclusive_end=True,
        exclude_debug=False,
    )
    by_route: dict[int, dict[str, Any]] = {}
    for fact in facts:
        if fact.route_id is None or fact.stage not in OUTCOME_STAGES:
            continue
        row = by_route.setdefault(
            fact.route_id,
            {
                "route_id": fact.route_id,
                "stream_id": fact.stream_id,
                "destination_id": fact.destination_id,
                "failure_count": 0,
                "success_count": 0,
                "last_failure_at": None,
                "last_success_at": None,
            },
        )
        if fact.stream_id is not None:
            row["stream_id"] = max(row["stream_id"] or fact.stream_id, fact.stream_id)
        if fact.destination_id is not None:
            row["destination_id"] = max(row["destination_id"] or fact.destination_id, fact.destination_id)
        if fact.stage in FAILURE_STAGES:
            row["failure_count"] += fact.event_count
            row["last_failure_at"] = max(row["last_failure_at"], fact.created_at) if row["last_failure_at"] else fact.created_at
        elif fact.stage in SUCCESS_STAGES:
            row["success_count"] += fact.event_count
            row["last_success_at"] = max(row["last_success_at"], fact.created_at) if row["last_success_at"] else fact.created_at
    return [
        SimpleNamespace(**row)
        for row in sorted(by_route.values(), key=lambda item: (-int(item["failure_count"]), int(item["route_id"])))
    ]


def dimension_failure_counts(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    dimension: str,
) -> list[SimpleNamespace]:
    facts = delivery_log_aggregate_facts(
        db,
        start_at=since,
        end_at=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        inclusive_end=True,
        exclude_debug=False,
    )
    counts: dict[int, int] = {}
    for fact in facts:
        if fact.stage not in FAILURE_STAGES:
            continue
        dim_id = fact.destination_id if dimension == "destination" else fact.stream_id
        if dim_id is None:
            continue
        counts[dim_id] = counts.get(dim_id, 0) + 1
    return [
        SimpleNamespace(dim_id=dim_id, failure_count=count)
        for dim_id, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:50]
    ]


def failure_trend_buckets(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    bucket_seconds: int,
) -> list[SimpleNamespace]:
    facts = delivery_log_aggregate_facts(
        db,
        start_at=since,
        end_at=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        inclusive_end=True,
        exclude_debug=False,
    )
    bs = max(60, int(bucket_seconds))
    counts: dict[float, int] = {}
    for fact in facts:
        if fact.stage in FAILURE_STAGES:
            key = bucket_epoch(fact.created_at, bs)
            counts[key] = counts.get(key, 0) + 1
    return [
        SimpleNamespace(bucket_start=datetime.fromtimestamp(epoch, tz=facts[0].created_at.tzinfo), failure_count=count)
        for epoch, count in sorted(counts.items())
    ]


def count_by_field(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    field: str,
    limit: int,
) -> list[SimpleNamespace]:
    facts = delivery_log_aggregate_facts(
        db,
        start_at=since,
        end_at=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        inclusive_end=True,
        exclude_debug=False,
    )
    counts: dict[str | None, int] = {}
    for fact in facts:
        if fact.stage not in FAILURE_STAGES:
            continue
        key = fact.error_code if field == "error_code" else fact.stage
        counts[key] = counts.get(key, 0) + 1
    lim = max(1, int(limit))
    return [
        SimpleNamespace(error_code=key, stage=key, row_count=count)
        for key, count in sorted(counts.items(), key=lambda item: (-item[1], "" if item[0] is None else str(item[0])))[:lim]
    ]


def latency_avg_p95(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
) -> tuple[float | None, float | None]:
    facts = delivery_log_aggregate_facts(
        db,
        start_at=since,
        end_at=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        inclusive_end=True,
        exclude_debug=False,
    )
    values = sorted(f.latency_ms for f in facts if f.stage in LATENCY_STAGES and f.latency_ms is not None)
    if not values:
        return None, None
    avg = sum(values) / len(values)
    idx = max(0, min(len(values) - 1, math.ceil(0.95 * len(values)) - 1))
    return float(avg), float(values[idx])


def last_event_times(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
) -> tuple[datetime | None, datetime | None]:
    facts = delivery_log_aggregate_facts(
        db,
        start_at=since,
        end_at=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        inclusive_end=True,
        exclude_debug=False,
    )
    failures = [f.created_at for f in facts if f.stage in FAILURE_STAGES]
    successes = [f.created_at for f in facts if f.stage in SUCCESS_STAGES]
    return (max(failures) if failures else None, max(successes) if successes else None)


def retry_summary(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
) -> tuple[int, int, int]:
    facts = delivery_log_aggregate_facts(
        db,
        start_at=since,
        end_at=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        inclusive_end=True,
        exclude_debug=False,
    )
    ok_n = bad_n = retry_sum = 0
    for fact in facts:
        if fact.stage not in RETRY_OUTCOME_STAGES:
            continue
        if fact.stage == "route_retry_success":
            ok_n += 1
        else:
            bad_n += 1
        retry_sum += fact.retry_count
    return ok_n, bad_n, retry_sum


def retry_heavy(
    db: Session,
    *,
    since: datetime,
    until: datetime,
    stream_id: int | None,
    route_id: int | None,
    destination_id: int | None,
    dimension: str,
    limit: int,
) -> list[SimpleNamespace]:
    facts = delivery_log_aggregate_facts(
        db,
        start_at=since,
        end_at=until,
        stream_id=stream_id,
        route_id=route_id,
        destination_id=destination_id,
        inclusive_end=True,
        exclude_debug=False,
    )
    acc: dict[int, dict[str, int]] = {}
    for fact in facts:
        if fact.stage not in RETRY_OUTCOME_STAGES:
            continue
        dim_id = fact.stream_id if dimension == "stream" else fact.route_id
        if dim_id is None:
            continue
        row = acc.setdefault(dim_id, {"evt": 0, "rsum": 0})
        row["evt"] += 1
        row["rsum"] += fact.retry_count
    lim = max(1, min(int(limit), 50))
    rows: list[SimpleNamespace] = []
    for dim_id, vals in sorted(acc.items(), key=lambda item: (-item[1]["evt"], item[0]))[:lim]:
        if dimension == "stream":
            rows.append(SimpleNamespace(stream_id=dim_id, evt=vals["evt"], rsum=vals["rsum"]))
        else:
            rows.append(SimpleNamespace(route_id=dim_id, evt=vals["evt"], rsum=vals["rsum"]))
    return rows
