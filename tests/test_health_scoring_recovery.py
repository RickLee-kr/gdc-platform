"""Health scoring recovery, decay, and current vs historical model consistency."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db
from app.main import app
from app.runtime import health_service
from app.runtime.health_scoring_model import (
    OutcomeAggregate,
    compute_health_score_for_mode,
    failure_decay_multiplier,
    live_scoring_aggregate,
    resolve_recent_posture_window,
)
from tests.test_runtime_health_scoring_endpoints import (
    _log,
    _seed_stream_two_routes,
    health_client,
)

UTC = timezone.utc


def _agg(
    *,
    failures: int = 0,
    successes: int = 0,
    last_failure: datetime | None = None,
    last_success: datetime | None = None,
) -> OutcomeAggregate:
    return OutcomeAggregate(
        failure_count=failures,
        success_count=successes,
        retry_event_count=0,
        retry_count_sum=0,
        rate_limit_count=0,
        latency_ms_avg=None,
        latency_ms_p95=None,
        last_failure_at=last_failure,
        last_success_at=last_success,
    )


def test_stale_failures_recover_after_sustained_success() -> None:
    now = datetime.now(UTC)
    old_fail = now - timedelta(hours=20)
    recent_ok = now - timedelta(minutes=10)
    full = _agg(failures=9, successes=50, last_failure=old_fail, last_success=recent_ok)
    recent = _agg(failures=0, successes=12, last_success=recent_ok)
    score = compute_health_score_for_mode(
        full, recent, scoring_mode="current_runtime", include_latency=False, now=now
    )
    assert score.level == "HEALTHY"
    assert score.score >= 90
    assert score.metrics.historical_failure_count == 9
    assert score.metrics.live_delivery_failure_rate == 0.0


def test_old_failures_decay_after_recovery() -> None:
    now = datetime.now(UTC)
    last_fail = now - timedelta(hours=4)
    last_ok = now - timedelta(hours=3)
    full = _agg(failures=30, successes=5, last_failure=last_fail, last_success=last_ok)
    decay = failure_decay_multiplier(full, now=now)
    assert decay < 0.5
    recent = _agg(failures=0, successes=8, last_success=now - timedelta(minutes=5))
    hist = compute_health_score_for_mode(
        full, recent, scoring_mode="historical_analytics", include_latency=False, now=now
    )
    live = compute_health_score_for_mode(
        full, recent, scoring_mode="current_runtime", include_latency=False, now=now
    )
    assert hist.score < live.score
    assert live.level in {"HEALTHY", "DEGRADED"}


def test_historical_preserves_failure_counts() -> None:
    now = datetime.now(UTC)
    full = _agg(failures=9, successes=1, last_failure=now - timedelta(hours=2), last_success=now - timedelta(minutes=1))
    recent = _agg(failures=0, successes=5, last_success=now - timedelta(minutes=1))
    hist = compute_health_score_for_mode(
        full, recent, scoring_mode="historical_analytics", include_latency=False, now=now
    )
    assert hist.metrics.historical_failure_count == 9
    assert hist.metrics.historical_delivery_failure_rate == pytest.approx(0.9, abs=0.01)
    assert hist.metrics.current_runtime_health == "HEALTHY"


def test_single_old_failure_cannot_stay_critical_forever() -> None:
    now = datetime.now(UTC)
    full = _agg(failures=1, successes=40, last_failure=now - timedelta(hours=10), last_success=now - timedelta(minutes=2))
    recent = _agg(failures=0, successes=10, last_success=now - timedelta(minutes=2))
    score = compute_health_score_for_mode(
        full, recent, scoring_mode="current_runtime", include_latency=False, now=now
    )
    assert score.level != "CRITICAL"


def test_stream67_like_recovery_empty_recent_window() -> None:
    """One old failure + later success; no events in recent 1h slice → live HEALTHY."""
    now = datetime.now(UTC)
    last_fail = now - timedelta(hours=12)
    last_ok = now - timedelta(hours=8)
    full = _agg(failures=1, successes=1, last_failure=last_fail, last_success=last_ok)
    recent = _agg()
    live = compute_health_score_for_mode(
        full,
        recent,
        scoring_mode="current_runtime",
        include_latency=False,
        now=now,
        recent_window_since=now - timedelta(hours=1),
        recent_window_until=now,
    )
    hist = compute_health_score_for_mode(
        full,
        recent,
        scoring_mode="historical_analytics",
        include_latency=False,
        now=now,
        recent_window_since=now - timedelta(hours=1),
        recent_window_until=now,
    )
    assert live.metrics.failure_count == 0
    assert live.metrics.success_count == 0
    assert live.metrics.historical_failure_count == 1
    assert live.metrics.historical_delivery_failure_rate == pytest.approx(0.5, abs=0.01)
    assert live.level in {"HEALTHY", "DEGRADED"}
    assert hist.metrics.failure_count == 1
    assert hist.level in {"UNHEALTHY", "CRITICAL", "DEGRADED"}
    assert live.score > hist.score


def test_current_runtime_diverges_from_historical_after_recovery() -> None:
    """Historical keeps full-window failures; current_runtime uses recent slice only."""
    now = datetime.now(UTC)
    full = _agg(
        failures=3,
        successes=1,
        last_failure=now - timedelta(hours=6),
        last_success=now - timedelta(minutes=20),
    )
    recent = _agg(failures=0, successes=1, last_success=now - timedelta(minutes=20))
    hist = compute_health_score_for_mode(
        full, recent, scoring_mode="historical_analytics", include_latency=False, now=now
    )
    live = compute_health_score_for_mode(
        full, recent, scoring_mode="current_runtime", include_latency=False, now=now
    )
    assert hist.metrics.failure_count == 3
    assert hist.metrics.success_count == 1
    assert live.metrics.failure_count == 0
    assert live.metrics.success_count == 1
    assert live.metrics.recent_failure_count == 0
    assert live.metrics.recent_success_count == 1
    assert live.level == "HEALTHY"
    assert hist.level in {"UNHEALTHY", "CRITICAL", "DEGRADED"}


def test_live_scoring_aggregate_zeros_stale_failures_after_recovery() -> None:
    now = datetime.now(UTC)
    full = _agg(failures=1, successes=1, last_failure=now - timedelta(hours=2), last_success=now - timedelta(minutes=5))
    recent = _agg(
        failures=1,
        successes=1,
        last_failure=now - timedelta(minutes=30),
        last_success=now - timedelta(minutes=5),
    )
    live_agg = live_scoring_aggregate(full, recent)
    assert live_agg.failure_count == 0
    assert live_agg.success_count == 1


def test_resolve_recent_posture_window_caps_at_one_hour() -> None:
    until = datetime.now(UTC)
    since = until - timedelta(hours=24)
    recent_since, _ = resolve_recent_posture_window(since, until)
    assert until - recent_since <= timedelta(hours=1)


def test_endpoint_current_vs_historical_diverge_after_recovery(
    health_client: TestClient, db_session: Session
) -> None:
    h = _seed_stream_two_routes(db_session, stream_name="hs-recovery")
    old = datetime.now(UTC) - timedelta(hours=20)
    recent = datetime.now(UTC) - timedelta(minutes=5)
    for i in range(9):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="route_send_failed",
            level="ERROR",
            status="FAILED",
            created_at=old + timedelta(seconds=i),
        )
    for i in range(15):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="route_send_success",
            created_at=recent + timedelta(seconds=i),
        )
    db_session.commit()

    live = health_client.get(
        "/api/v1/runtime/health/streams",
        params={"window": "24h", "scoring_mode": "current_runtime"},
    ).json()
    hist = health_client.get(
        "/api/v1/runtime/health/streams",
        params={"window": "24h", "scoring_mode": "historical_analytics"},
    ).json()
    live_row = next(r for r in live["rows"] if r["stream_id"] == h["stream_id"])
    hist_row = next(r for r in hist["rows"] if r["stream_id"] == h["stream_id"])
    assert live_row["level"] == "HEALTHY"
    assert hist_row["metrics"]["historical_failure_count"] == 9
    assert hist_row["level"] in {"UNHEALTHY", "CRITICAL", "DEGRADED"}


def test_operations_overview_uses_current_posture_by_default(
    health_client: TestClient, db_session: Session
) -> None:
    h = _seed_stream_two_routes(db_session, stream_name="hs-ops-default")
    old = datetime.now(UTC) - timedelta(hours=18)
    recent = datetime.now(UTC) - timedelta(minutes=3)
    for i in range(8):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="route_send_failed",
            level="ERROR",
            status="FAILED",
            created_at=old + timedelta(seconds=i),
        )
    for i in range(12):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="route_send_success",
            created_at=recent + timedelta(seconds=i),
        )
    db_session.commit()
    overview = health_client.get("/api/v1/runtime/health/overview", params={"window": "24h"}).json()
    assert overview["scoring_mode"] == "current_runtime"
    assert overview["streams"]["healthy"] >= 1
    assert overview["streams"]["critical"] == 0


def test_page_aggregation_consistency_same_mode(
    health_client: TestClient, db_session: Session
) -> None:
    h = _seed_stream_two_routes(db_session, stream_name="hs-consistency")
    t = datetime.now(UTC) - timedelta(minutes=10)
    for i in range(6):
        _log(
            db_session,
            connector_id=h["connector_id"],
            stream_id=h["stream_id"],
            route_id=h["route_a_id"],
            destination_id=h["dest_a_id"],
            stage="route_send_success",
            created_at=t + timedelta(seconds=i),
        )
    db_session.commit()
    overview = health_client.get(
        "/api/v1/runtime/health/overview",
        params={"window": "24h", "scoring_mode": "current_runtime"},
    ).json()
    streams = health_client.get(
        "/api/v1/runtime/health/streams",
        params={"window": "24h", "scoring_mode": "current_runtime"},
    ).json()
    assert overview["scoring_mode"] == streams["scoring_mode"]
    stream_row = next(r for r in streams["rows"] if r["stream_id"] == h["stream_id"])
    assert stream_row["level"] == "HEALTHY"
    assert overview["streams"]["healthy"] == overview["streams"]["healthy"]  # noqa: PLR0124
    assert overview["streams"]["healthy"] >= 1
