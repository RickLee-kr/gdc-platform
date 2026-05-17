from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.runtime.observability_metric_contract import OBSERVABILITY_METRIC_CONTRACT
from app.runtime.observability_summary import get_observability_summary
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

