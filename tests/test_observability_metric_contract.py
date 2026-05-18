from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.runtime.observability_metric_contract import OBSERVABILITY_METRIC_CONTRACT
from app.runtime.observability_summary import get_observability_summary
from app.runtime.metrics_service import build_stream_runtime_metrics
from app.runtime.health_service import get_health_overview
from tests.test_runtime_dashboard_summary_endpoint import _log, _mk_stream_hierarchy


UTC = timezone.utc


def test_required_observability_metric_contract_keys_are_defined() -> None:
    required = {
        "runtime_telemetry_rows",
        "lifecycle_rows",
        "delivery_success_events",
        "delivery_failed_events",
        "retry_success_events",
        "retry_failed_events",
        "processed_events",
        "healthy_routes",
        "idle_routes",
        "unhealthy_routes",
        "throughput_eps",
        "p95_latency_ms",
    }
    assert required.issubset(set(OBSERVABILITY_METRIC_CONTRACT))
    for key in required:
        definition = OBSERVABILITY_METRIC_CONTRACT[key]
        assert definition.semantic_meaning
        assert definition.aggregation_rule
        assert definition.window_rule
        assert definition.snapshot_consistency_rule
        assert definition.display_semantics


def test_observability_summary_separates_global_rows_outcomes_and_lifecycle(db_session: Session) -> None:
    h = _mk_stream_hierarchy(db_session, stream_status="RUNNING")
    base = datetime.now(UTC) - timedelta(minutes=5)
    common = {
        "connector_id": h["connector_id"],
        "stream_id": h["stream_id"],
        "route_id": h["route_id"],
        "destination_id": h["destination_id"],
        "created_at": base,
    }
    _log(db_session, **common, stage="route_send_success", payload_sample={"event_count": 3})
    _log(db_session, **common, stage="route_send_failed", payload_sample={"event_count": 2}, level="ERROR")
    _log(db_session, **common, stage="route_retry_success", payload_sample={"event_count": 1})
    _log(db_session, **common, stage="run_complete", payload_sample={"input_events": 9})
    db_session.commit()

    summary = get_observability_summary(
        db_session,
        window="1h",
        snapshot_id=datetime.now(UTC).isoformat(),
    )

    assert summary.metric_contract_version == "v1"
    assert summary.totals.runtime_telemetry_rows >= 4
    assert summary.totals.delivery_success_events >= 3
    assert summary.totals.delivery_failed_events >= 2
    assert summary.totals.retry_success_events >= 1
    assert summary.totals.processed_events >= 9
    assert summary.totals.lifecycle_rows >= 1
    assert summary.totals.throughput_eps > 0


def test_per_stream_metrics_use_selected_24h_window_denominator(db_session: Session) -> None:
    h = _mk_stream_hierarchy(db_session, stream_status="RUNNING")
    snapshot = datetime(2026, 1, 2, 0, 0, tzinfo=UTC)
    base = snapshot - timedelta(hours=1)
    common = {
        "connector_id": h["connector_id"],
        "stream_id": h["stream_id"],
        "route_id": h["route_id"],
        "destination_id": h["destination_id"],
        "created_at": base,
    }
    _log(db_session, **common, stage="run_complete", payload_sample={"input_events": 9})
    _log(db_session, **common, stage="route_send_success", payload_sample={"event_count": 9})
    db_session.commit()

    metrics = build_stream_runtime_metrics(
        db_session,
        h["stream_id"],
        window="24h",
        snapshot_id=snapshot.isoformat(),
    )

    assert metrics.metrics_window_seconds == 86_400
    assert metrics.kpis.events_last_hour == 9
    assert metrics.kpis.events_last_hour / metrics.metrics_window_seconds == 9 / 86_400
    assert metrics.route_runtime[0].eps_current == round(9 / 86_400, 6)


def test_observability_summary_throughput_uses_24h_window_for_sparse_counts(db_session: Session) -> None:
    h = _mk_stream_hierarchy(db_session, stream_status="RUNNING")
    snapshot = datetime(2026, 1, 2, 0, 0, tzinfo=UTC)
    common = {
        "connector_id": h["connector_id"],
        "stream_id": h["stream_id"],
        "route_id": h["route_id"],
        "destination_id": h["destination_id"],
        "created_at": snapshot - timedelta(hours=1),
    }
    _log(db_session, **common, stage="route_send_success", payload_sample={"event_count": 296})
    db_session.commit()

    summary = get_observability_summary(db_session, window="24h", snapshot_id=snapshot.isoformat())

    assert summary.totals.delivery_success_events == 296
    assert summary.totals.throughput_eps == round(296 / 86_400, 6)


def test_historical_health_metadata_reports_scored_and_total_entities(db_session: Session) -> None:
    active = _mk_stream_hierarchy(db_session, stream_status="RUNNING")
    _mk_stream_hierarchy(db_session, stream_status="RUNNING")
    snapshot = datetime(2026, 1, 2, 0, 0, tzinfo=UTC)
    _log(
        db_session,
        connector_id=active["connector_id"],
        stream_id=active["stream_id"],
        route_id=active["route_id"],
        destination_id=active["destination_id"],
        stage="route_send_success",
        created_at=snapshot - timedelta(hours=1),
        payload_sample={"event_count": 1},
    )
    db_session.commit()

    overview = get_health_overview(
        db_session,
        window="24h",
        since=None,
        stream_id=None,
        route_id=None,
        destination_id=None,
        scoring_mode="historical_analytics",
        snapshot_id=snapshot.isoformat(),
    )

    assert overview.streams.scored >= 1
    assert overview.streams.total >= overview.streams.scored + 1
    assert overview.streams.excluded_no_outcome >= 1
    assert overview.streams.scoring_exclusion_reason is not None
    assert overview.routes.scored >= 1
    assert overview.routes.total >= overview.routes.scored + overview.routes.idle

