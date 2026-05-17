"""Runtime aggregate query boundary selection.

The public API contract stays unchanged, but service code should be explicit
about whether an aggregate is a live operational read or a historical analytic
read. Live reads use short-lived snapshots only for UI refresh alignment.
Historical reads can use materialized snapshots as the retention-stable anchor.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar, Literal

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.runtime.snapshot_materialization import get_or_materialize_snapshot

AggregateQueryPath = Literal["live", "historical"]
T = TypeVar("T", bound=BaseModel)

HISTORICAL_SNAPSHOT_TTL_SECONDS = 100 * 365 * 24 * 60 * 60

_LIVE_SURFACES = frozenset(
    {
        "runtime_dashboard_summary",
        "runtime_dashboard_outcome_timeseries",
        "stream_runtime_metrics",
        "routes_overview",
    }
)
_HISTORICAL_SURFACES = frozenset(
    {
        "runtime_analytics",
        "analytics_route_failures",
        "analytics_delivery_outcomes_by_destination",
        "analytics_stream_retries",
        "analytics_retry_summary",
    }
)


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
