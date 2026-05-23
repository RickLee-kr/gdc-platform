"""Runtime read-path taxonomy: operational snapshot vs analytics buckets vs forensic logs.

The public API contract stays unchanged, but service code should be explicit
about which physical read model backs each aggregate.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal, TypeVar

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.runtime.snapshot_materialization import get_or_materialize_snapshot

QueryCategory = Literal[
    "runtime_operational_snapshot",
    "runtime_analytics_bucket",
    "runtime_forensic_logs",
]
AggregateQueryPath = Literal["live", "historical"]
T = TypeVar("T", bound=BaseModel)

HISTORICAL_SNAPSHOT_TTL_SECONDS = 100 * 365 * 24 * 60 * 60

# Surfaces that read current operational posture from runtime_*_snapshot.
_OPERATIONAL_SNAPSHOT_SURFACES = frozenset(
    {
        "runtime_operational_snapshot",
        "runtime_dashboard_summary",
        "runtime_dashboard_outcome_timeseries_operational",
        "analytics_retry_summary_operational",
    }
)

# Surfaces that read pre-aggregated historical buckets (Phase 6).
_ANALYTICS_BUCKET_SURFACES = frozenset(
    {
        "runtime_dashboard_outcome_timeseries",
        "runtime_analytics_route_failures",
        "runtime_analytics_route_failures_scoped",
        "runtime_analytics_delivery_outcomes",
        "runtime_analytics_stream_retries",
        "runtime_analytics_failure_trend",
        "runtime_analytics_outcome_totals",
        "runtime_analytics_latency",
    }
)

# Surfaces that still scan delivery_logs (forensic / top-N / audit).
_FORENSIC_LOG_SURFACES = frozenset(
    {
        "runtime_observability_summary",
        "runtime_logs_search",
        "runtime_logs_page",
        "runtime_logs_totals",
        "runtime_failures_trend_forensic",
        "runtime_analytics_top_error_codes",
        "runtime_analytics_top_failed_stages",
        "runtime_analytics_last_event_times",
        "stream_runtime_metrics",
        "routes_overview",
        "runtime_health",
    }
)

_LIVE_SURFACES = _OPERATIONAL_SNAPSHOT_SURFACES | frozenset(
    {
        "runtime_observability_summary",
        "stream_runtime_metrics",
        "routes_overview",
    }
)
_HISTORICAL_SURFACES = _ANALYTICS_BUCKET_SURFACES | frozenset(
    {
        "runtime_analytics",
        "analytics_route_failures",
        "analytics_delivery_outcomes_by_destination",
        "analytics_stream_retries",
    }
)


def classify_query_category(surface: str) -> QueryCategory:
    """Map a stable surface name to the three-layer read taxonomy."""

    normalized = str(surface).strip()
    if normalized in _OPERATIONAL_SNAPSHOT_SURFACES:
        return "runtime_operational_snapshot"
    if normalized in _ANALYTICS_BUCKET_SURFACES:
        return "runtime_analytics_bucket"
    return "runtime_forensic_logs"


def select_aggregate_query_path(
    surface: str,
    *,
    scoring_mode: str | None = None,
) -> AggregateQueryPath:
    """Resolve the internal aggregate path for a stable public endpoint."""

    normalized = str(surface).strip()
    if normalized == "routes_overview" and scoring_mode == "historical_analytics":
        return "historical"
    if normalized in _HISTORICAL_SURFACES:
        return "historical"
    if normalized in _LIVE_SURFACES:
        return "live"
    return "historical"


def materialize_live_aggregate_snapshot(
    db: Session,
    *,
    scope: str,
    key: str,
    snapshot_id: str,
    model_type: type[T],
    builder: Callable[[], T],
) -> T:
    """Short-lived snapshot for coherent live dashboard refresh cycles."""

    return get_or_materialize_snapshot(
        db,
        scope=scope,
        key=key,
        snapshot_id=snapshot_id,
        model_type=model_type,
        builder=builder,
    )


def materialize_historical_aggregate_snapshot(
    db: Session,
    *,
    scope: str,
    key: str,
    snapshot_id: str,
    model_type: type[T],
    builder: Callable[[], T],
) -> T:
    """Retention-stable snapshot for historical analytics windows."""

    return get_or_materialize_snapshot(
        db,
        scope=scope,
        key=key,
        snapshot_id=snapshot_id,
        model_type=model_type,
        builder=builder,
        ttl_seconds=HISTORICAL_SNAPSHOT_TTL_SECONDS,
    )
