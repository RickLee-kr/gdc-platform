"""Visualization ontology contract metadata."""

from __future__ import annotations

from app.runtime.metric_contract import METRIC_CONTRACT
from app.runtime.visualization_contract import VISUALIZATION_CONTRACT, NormalizationRule, get_visualization_meta


REQUIRED_FIELDS = {
    "metric_id",
    "chart_metric_id",
    "aggregation_type",
    "visualization_type",
    "normalization_rule",
    "bucket_unit",
    "bucket_size_seconds",
    "y_axis_semantics",
    "avg_vs_peak_semantics",
    "cumulative_semantics",
    "subset_semantics",
    "chart_window_semantics",
    "snapshot_alignment_required",
    "display_unit",
    "tooltip_template",
}


def test_required_visualization_chart_metrics_are_registered() -> None:
    required = {
        "runtime.throughput.window_avg_eps",
        "runtime.throughput.bucket_eps",
        "routes.throughput.window_avg_eps",
        "routes.throughput.bucket_eps",
        "dashboard.delivery_outcomes.bucket_count",
        "stream.processed_events.bucket_count",
        "stream.delivery_outcomes.bucket_count",
        "analytics.delivery_failures.bucket_histogram",
        "runtime_telemetry.rows.bucket_count",
        "runtime.top_streams.throughput_share.window_avg_eps",
        "routes.destination_delivery_outcomes.donut_count",
        "routes.success_rate.bucket_ratio",
        "routes.latency.bucket_avg_ms",
    }
    assert required.issubset(VISUALIZATION_CONTRACT.keys())


def test_visualization_contract_references_metric_contract() -> None:
    for chart_metric_id, definition in VISUALIZATION_CONTRACT.items():
        assert definition.chart_metric_id == chart_metric_id
        assert definition.metric_id in METRIC_CONTRACT
        meta = get_visualization_meta(chart_metric_id, bucket_size_seconds=300, bucket_count=12)
        assert REQUIRED_FIELDS.issubset(meta.keys())
        assert meta["chart_metric_id"] == chart_metric_id
        assert meta["metric_id"] == definition.metric_id
        assert meta["normalization_rule"] in {x.value for x in NormalizationRule}


def test_throughput_chart_metrics_do_not_mix_normalization_rules() -> None:
    throughput = {
        cid: definition.normalization_rule.value
        for cid, definition in VISUALIZATION_CONTRACT.items()
        if "throughput" in cid
    }
    assert throughput["runtime.throughput.window_avg_eps"] == "eps_window_avg"
    assert throughput["runtime.throughput.bucket_eps"] == "eps_bucket"
    assert throughput["routes.throughput.window_avg_eps"] == "eps_window_avg"
    assert throughput["routes.throughput.bucket_eps"] == "eps_bucket"
    assert len(set(throughput.values())) > 1

